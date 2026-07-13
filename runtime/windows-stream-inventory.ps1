param(
  [Parameter(Mandatory = $true)]
  [string]$RootPath
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false, $true)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false, $true)

# DEEP_WORK_PINVOKE_SOURCE_BEGIN
$source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

internal static class DeepWorkStreamInventoryNative {
    internal enum STREAM_INFO_LEVELS { FindStreamInfoStandard = 0 }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct WIN32_FIND_STREAM_DATA {
        internal long StreamSize;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 296)]
        internal string cStreamName;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern IntPtr FindFirstStreamW(
        string lpFileName,
        STREAM_INFO_LEVELS InfoLevel,
        out WIN32_FIND_STREAM_DATA lpFindStreamData,
        uint dwFlags);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool FindNextStreamW(
        IntPtr hFindStream,
        out WIN32_FIND_STREAM_DATA lpFindStreamData);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool FindClose(IntPtr hFindFile);

    internal static int GetLastWin32Error() {
        return Marshal.GetLastWin32Error();
    }
}
'@
# DEEP_WORK_PINVOKE_SOURCE_END

Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop

function Convert-ToExtendedPath([string]$PathValue) {
  if ($PathValue.StartsWith('\\?\')) { return $PathValue }
  if ($PathValue.StartsWith('\\')) { return '\\?\UNC\' + $PathValue.Substring(2) }
  return '\\?\' + $PathValue
}

function Assert-WellFormedUtf16([string]$Value, [string]$Field) {
  for ($i = 0; $i -lt $Value.Length; $i++) {
    $code = [int][char]$Value[$i]
    if ($code -ge 0xD800 -and $code -le 0xDBFF) {
      if ($i + 1 -ge $Value.Length) { throw "$Field contains an unpaired high surrogate" }
      $next = [int][char]$Value[$i + 1]
      if ($next -lt 0xDC00 -or $next -gt 0xDFFF) { throw "$Field contains an unpaired high surrogate" }
      $i++
    } elseif ($code -ge 0xDC00 -and $code -le 0xDFFF) {
      throw "$Field contains an unpaired low surrogate"
    }
  }
}

function Compare-Utf8([string]$Left, [string]$Right) {
  $a = [System.Text.Encoding]::UTF8.GetBytes($Left)
  $b = [System.Text.Encoding]::UTF8.GetBytes($Right)
  $limit = [Math]::Min($a.Length, $b.Length)
  for ($i = 0; $i -lt $limit; $i++) {
    if ($a[$i] -lt $b[$i]) { return -1 }
    if ($a[$i] -gt $b[$i]) { return 1 }
  }
  return $a.Length.CompareTo($b.Length)
}

function Get-CompleteStreamSet([string]$LiteralPath) {
  $data = New-Object DeepWorkStreamInventoryNative+WIN32_FIND_STREAM_DATA
  $handle = [DeepWorkStreamInventoryNative]::FindFirstStreamW(
    $LiteralPath,
    [DeepWorkStreamInventoryNative+STREAM_INFO_LEVELS]::FindStreamInfoStandard,
    [ref]$data,
    0)
  $invalidHandle = [IntPtr]::new(-1)
  if ($handle -eq $invalidHandle) {
    $code = [DeepWorkStreamInventoryNative]::GetLastWin32Error()
    if ($code -eq 38) { return @() }
    throw "FindFirstStreamW failed with Win32 error $code"
  }
  $streams = [System.Collections.Generic.List[object]]::new()
  $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  try {
    while ($true) {
      Assert-WellFormedUtf16 $data.cStreamName 'stream_name'
      if ($data.StreamSize -lt 0) { throw 'stream size is negative' }
      if (-not $seen.Add($data.cStreamName)) { throw 'duplicate stream name' }
      $streams.Add([ordered]@{ name = $data.cStreamName; size = [long]$data.StreamSize })
      $next = New-Object DeepWorkStreamInventoryNative+WIN32_FIND_STREAM_DATA
      if (-not [DeepWorkStreamInventoryNative]::FindNextStreamW($handle, [ref]$next)) {
        $code = [DeepWorkStreamInventoryNative]::GetLastWin32Error()
        if ($code -ne 38) { throw "FindNextStreamW failed with Win32 error $code" }
        break
      }
      $data = $next
    }
  } finally {
    if (-not [DeepWorkStreamInventoryNative]::FindClose($handle)) {
      $code = [DeepWorkStreamInventoryNative]::GetLastWin32Error()
      throw "FindClose failed with Win32 error $code"
    }
  }
  $array = $streams.ToArray()
  [Array]::Sort($array, [Comparison[object]]{
    param($left, $right)
    Compare-Utf8 ([string]$left.name) ([string]$right.name)
  })
  return $array
}

$root = [System.IO.Path]::GetFullPath($RootPath)
$expectedId = 0
while (($line = [Console]::In.ReadLine()) -ne $null) {
  if ([System.Text.Encoding]::UTF8.GetByteCount($line) -gt 32768) { throw 'input row exceeds byte limit' }
  $row = $line | ConvertFrom-Json -ErrorAction Stop
  $properties = @($row.PSObject.Properties.Name | Sort-Object)
  if (($properties -join ',') -ne 'id,kind,relative_path,version') { throw 'input row has unknown or missing fields' }
  if ($row.version -ne 1 -or $row.id -ne $expectedId) { throw 'input row version or sequence is invalid' }
  if ($row.kind -notin @('root', 'directory', 'file')) { throw 'input row kind is invalid' }
  if ($row.kind -eq 'root') {
    if ($null -ne $row.relative_path) { throw 'root relative_path must be null' }
    $literal = $root
  } else {
    if ($row.relative_path -isnot [string] -or $row.relative_path.Length -eq 0) {
      throw 'non-root relative_path must be a string'
    }
    Assert-WellFormedUtf16 $row.relative_path 'relative_path'
    $literal = [System.IO.Path]::Combine($root, $row.relative_path.Replace('/', '\'))
  }
  $streams = Get-CompleteStreamSet (Convert-ToExtendedPath $literal)
  [ordered]@{
    version = 1
    id = [int]$row.id
    kind = [string]$row.kind
    streams = @($streams)
  } | ConvertTo-Json -Compress -Depth 5
  $expectedId++
}
