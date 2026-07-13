param(
  [Parameter(Mandatory = $true)]
  [string]$RootPath
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false, $true)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false, $true)

# DEEP_WORK_PINVOKE_SOURCE_BEGIN
$assemblyName = [System.Reflection.AssemblyName]::new('DeepWorkStreamInventoryNativeAssembly')
$assemblyAccess = [System.Reflection.Emit.AssemblyBuilderAccess]::Run
$staticFactory = [System.Reflection.Emit.AssemblyBuilder].GetMethods() |
  Where-Object {
    $_.Name -eq 'DefineDynamicAssembly' -and $_.IsStatic -and
    $_.GetParameters().Length -eq 2
  } | Select-Object -First 1
if ($null -ne $staticFactory) {
  $assemblyBuilder = $staticFactory.Invoke($null, @($assemblyName, $assemblyAccess))
} else {
  $assemblyBuilder = [AppDomain]::CurrentDomain.DefineDynamicAssembly($assemblyName, $assemblyAccess)
}
$moduleBuilder = $assemblyBuilder.DefineDynamicModule('DeepWorkStreamInventoryNativeModule')
$nativeAttributes = [System.Reflection.TypeAttributes](
  [System.Reflection.TypeAttributes]::Public -bor
  [System.Reflection.TypeAttributes]::Sealed -bor
  [System.Reflection.TypeAttributes]::Abstract -bor
  [System.Reflection.TypeAttributes]::BeforeFieldInit)
$nativeBuilder = $moduleBuilder.DefineType('DeepWorkStreamInventoryNative', $nativeAttributes)
$streamDataAttributes = [System.Reflection.TypeAttributes](
  [System.Reflection.TypeAttributes]::NestedPublic -bor
  [System.Reflection.TypeAttributes]::Sealed -bor
  [System.Reflection.TypeAttributes]::SequentialLayout -bor
  [System.Reflection.TypeAttributes]::UnicodeClass -bor
  [System.Reflection.TypeAttributes]::BeforeFieldInit)
$streamDataBuilder = $nativeBuilder.DefineNestedType('WIN32_FIND_STREAM_DATA',
  $streamDataAttributes, [ValueType])
$fieldAttributes = [System.Reflection.FieldAttributes]::Public
[void]$streamDataBuilder.DefineField('StreamSize', [Int64], $fieldAttributes)
$streamNameField = $streamDataBuilder.DefineField('cStreamName', [String], $fieldAttributes)
$marshalConstructor = [System.Runtime.InteropServices.MarshalAsAttribute].GetConstructor(
  [Type[]]@([System.Runtime.InteropServices.UnmanagedType]))
$sizeConstField = [System.Runtime.InteropServices.MarshalAsAttribute].GetField('SizeConst')
$marshalAttribute = [System.Reflection.Emit.CustomAttributeBuilder]::new(
  $marshalConstructor,
  [Object[]]@([System.Runtime.InteropServices.UnmanagedType]::ByValTStr),
  [System.Reflection.FieldInfo[]]@($sizeConstField),
  [Object[]]@(296))
$streamNameField.SetCustomAttribute($marshalAttribute)
$streamDataType = $streamDataBuilder

function Add-ClosedPInvokeMethod(
  [System.Reflection.Emit.TypeBuilder]$TypeBuilder,
  [string]$Name,
  [Type]$ReturnType,
  [Type[]]$ParameterTypes,
  [System.Runtime.InteropServices.CharSet]$CharSet
) {
  $methodAttributes = [System.Reflection.MethodAttributes](
    [System.Reflection.MethodAttributes]::Public -bor
    [System.Reflection.MethodAttributes]::Static -bor
    [System.Reflection.MethodAttributes]::PinvokeImpl)
  $method = $TypeBuilder.DefineMethod($Name, $methodAttributes, $ReturnType, $ParameterTypes)
  $constructor = [System.Runtime.InteropServices.DllImportAttribute].GetConstructor(
    [Type[]]@([String]))
  $namedFields = [System.Reflection.FieldInfo[]]@(
    [System.Runtime.InteropServices.DllImportAttribute].GetField('EntryPoint'),
    [System.Runtime.InteropServices.DllImportAttribute].GetField('CharSet'),
    [System.Runtime.InteropServices.DllImportAttribute].GetField('CallingConvention'),
    [System.Runtime.InteropServices.DllImportAttribute].GetField('SetLastError'),
    [System.Runtime.InteropServices.DllImportAttribute].GetField('ExactSpelling'),
    [System.Runtime.InteropServices.DllImportAttribute].GetField('PreserveSig'))
  $namedValues = [Object[]]@(
    $Name,
    $CharSet,
    [System.Runtime.InteropServices.CallingConvention]::Winapi,
    $true,
    $true,
    $true)
  $attribute = [System.Reflection.Emit.CustomAttributeBuilder]::new(
    $constructor, [Object[]]@('kernel32.dll'), $namedFields, $namedValues)
  $method.SetCustomAttribute($attribute)
  $method.SetImplementationFlags(
    $method.GetMethodImplementationFlags() -bor
    [System.Reflection.MethodImplAttributes]::PreserveSig)
  return $method
}

$streamDataByRef = $streamDataType.MakeByRefType()
$findFirstDefinition = @{
  TypeBuilder = $nativeBuilder
  Name = 'FindFirstStreamW'
  ReturnType = [IntPtr]
  ParameterTypes = [Type[]]@([String], [Int32], $streamDataByRef, [UInt32])
  CharSet = [System.Runtime.InteropServices.CharSet]::Unicode
}
$findNextDefinition = @{
  TypeBuilder = $nativeBuilder
  Name = 'FindNextStreamW'
  ReturnType = [Boolean]
  ParameterTypes = [Type[]]@([IntPtr], $streamDataByRef)
  CharSet = [System.Runtime.InteropServices.CharSet]::Unicode
}
$findCloseDefinition = @{
  TypeBuilder = $nativeBuilder
  Name = 'FindClose'
  ReturnType = [Boolean]
  ParameterTypes = [Type[]]@([IntPtr])
  CharSet = [System.Runtime.InteropServices.CharSet]::None
}
[void](Add-ClosedPInvokeMethod @findFirstDefinition)
[void](Add-ClosedPInvokeMethod @findNextDefinition)
[void](Add-ClosedPInvokeMethod @findCloseDefinition)

# DEEP_WORK_TYPE_RESOLVE_HANDLER_BEGIN
$expectedStreamDataTypeName = 'DeepWorkStreamInventoryNative+WIN32_FIND_STREAM_DATA'
$typeResolveState = [PSCustomObject]@{
  Requests = 0
  Type = $null
  Failure = $null
}
$typeResolveCallback = {
  param($sender, $eventArgs)
  try {
    $typeResolveState.Requests++
    if (-not [String]::Equals($eventArgs.Name, $expectedStreamDataTypeName,
        [System.StringComparison]::Ordinal)) {
      $typeResolveState.Failure = 'stream type resolve name mismatch'
      return $null
    }
    if ($typeResolveState.Requests -ne 1) {
      $typeResolveState.Failure = 'stream type resolve duplicate'
      return $null
    }
    $resolvedStreamDataType = $streamDataBuilder.CreateType()
    if ($null -eq $resolvedStreamDataType -or
        -not [String]::Equals($resolvedStreamDataType.FullName, $expectedStreamDataTypeName,
          [System.StringComparison]::Ordinal) -or
        -not $resolvedStreamDataType.IsValueType -or
        -not [Object]::ReferenceEquals($resolvedStreamDataType.Assembly, $assemblyBuilder)) {
      $typeResolveState.Failure = 'stream type resolve result mismatch'
      return $null
    }
    $typeResolveState.Type = $resolvedStreamDataType
    return $assemblyBuilder
  } catch {
    $typeResolveState.Failure = 'stream type resolve failed'
    return $null
  }
}.GetNewClosure()
$typeResolveHandler = [System.ResolveEventHandler]$typeResolveCallback
# DEEP_WORK_TYPE_RESOLVE_HANDLER_END

# DEEP_WORK_TYPE_RESOLVE_SCOPE_BEGIN
$currentDomain = [AppDomain]::CurrentDomain
$nativeTypeFailure = $false
$currentDomain.add_TypeResolve($typeResolveHandler)
try {
  $nativeType = $nativeBuilder.CreateType()
} catch {
  $nativeTypeFailure = $true
} finally {
  $currentDomain.remove_TypeResolve($typeResolveHandler)
}
# DEEP_WORK_TYPE_RESOLVE_SCOPE_END

# DEEP_WORK_TYPE_AUTHENTICATION_BEGIN
if ($nativeTypeFailure) { throw 'stream native type creation failed' }
if ($typeResolveState.Requests -ne 1 -or $null -ne $typeResolveState.Failure -or
    $null -eq $typeResolveState.Type) {
  throw 'stream type resolution state invalid'
}
$nestedTypeFlags = [System.Reflection.BindingFlags]::Public -bor
  [System.Reflection.BindingFlags]::NonPublic
$streamDataType = $nativeType.GetNestedType('WIN32_FIND_STREAM_DATA', $nestedTypeFlags)
if ($null -eq $streamDataType -or
    -not [String]::Equals($streamDataType.FullName, $expectedStreamDataTypeName,
      [System.StringComparison]::Ordinal) -or
    -not [Object]::ReferenceEquals($streamDataType, $typeResolveState.Type) -or
    -not [Object]::ReferenceEquals($streamDataType.DeclaringType, $nativeType) -or
    -not [Object]::ReferenceEquals($streamDataType.Assembly, $assemblyBuilder) -or
    -not [String]::Equals($streamDataType.Module.ScopeName, $moduleBuilder.ScopeName,
      [System.StringComparison]::Ordinal)) {
  throw 'stream type identity invalid'
}
if (-not $streamDataType.IsValueType -or -not $streamDataType.IsNestedPublic -or
    -not $streamDataType.IsSealed -or -not $streamDataType.IsLayoutSequential -or
    -not $streamDataType.IsUnicodeClass -or
    ($streamDataType.Attributes -band [System.Reflection.TypeAttributes]::BeforeFieldInit) -eq 0) {
  throw 'stream type layout invalid'
}
$streamFieldFlags = [System.Reflection.BindingFlags]::Public -bor
  [System.Reflection.BindingFlags]::NonPublic -bor
  [System.Reflection.BindingFlags]::Instance -bor
  [System.Reflection.BindingFlags]::Static -bor
  [System.Reflection.BindingFlags]::DeclaredOnly
$streamFields = @($streamDataType.GetFields($streamFieldFlags))
$streamSizeField = $streamDataType.GetField('StreamSize', $streamFieldFlags)
$streamNameRuntimeField = $streamDataType.GetField('cStreamName', $streamFieldFlags)
if ($streamFields.Length -ne 2 -or $null -eq $streamSizeField -or
    $streamSizeField.FieldType -ne [Int64] -or -not $streamSizeField.IsPublic -or
    $streamSizeField.IsStatic -or $null -eq $streamNameRuntimeField -or
    $streamNameRuntimeField.FieldType -ne [String] -or -not $streamNameRuntimeField.IsPublic -or
    $streamNameRuntimeField.IsStatic) {
  throw 'stream type fields invalid'
}
$streamNameMarshal = @($streamNameRuntimeField.GetCustomAttributes(
  [System.Runtime.InteropServices.MarshalAsAttribute], $false))
if ($streamNameMarshal.Length -ne 1 -or
    $streamNameMarshal[0].Value -ne [System.Runtime.InteropServices.UnmanagedType]::ByValTStr -or
    $streamNameMarshal[0].SizeConst -ne 296) {
  throw 'stream type marshal invalid'
}
$nativeMethodFlags = [System.Reflection.BindingFlags]::Public -bor
  [System.Reflection.BindingFlags]::Static -bor
  [System.Reflection.BindingFlags]::DeclaredOnly
$nativeMethods = @($nativeType.GetMethods($nativeMethodFlags))
$findFirstStream = $nativeType.GetMethod('FindFirstStreamW', $nativeMethodFlags)
$findNextStream = $nativeType.GetMethod('FindNextStreamW', $nativeMethodFlags)
$findClose = $nativeType.GetMethod('FindClose', $nativeMethodFlags)
if ($nativeMethods.Length -ne 3 -or $null -eq $findFirstStream -or
    $null -eq $findNextStream -or $null -eq $findClose) {
  throw 'stream native methods invalid'
}

function Assert-ClosedPInvokeRuntimeMethod(
  [System.Reflection.MethodInfo]$Method,
  [string]$Name,
  [Type]$ReturnType,
  [Type[]]$ParameterTypes,
  [System.Runtime.InteropServices.CharSet]$CharSet
) {
  if (-not [String]::Equals($Method.Name, $Name, [System.StringComparison]::Ordinal) -or
      $Method.ReturnType -ne $ReturnType) {
    throw 'stream native signature invalid'
  }
  $actualParameters = @($Method.GetParameters())
  if ($actualParameters.Length -ne $ParameterTypes.Length) {
    throw 'stream native signature invalid'
  }
  for ($parameterIndex = 0; $parameterIndex -lt $ParameterTypes.Length; $parameterIndex++) {
    if ($actualParameters[$parameterIndex].ParameterType -ne $ParameterTypes[$parameterIndex]) {
      throw 'stream native signature invalid'
    }
  }
  $imports = @($Method.GetCustomAttributes(
    [System.Runtime.InteropServices.DllImportAttribute], $false))
  if ($imports.Length -ne 1 -or
      -not [String]::Equals($imports[0].Value, 'kernel32.dll',
        [System.StringComparison]::Ordinal) -or
      -not [String]::Equals($imports[0].EntryPoint, $Name,
        [System.StringComparison]::Ordinal) -or
      $imports[0].CharSet -ne $CharSet -or
      $imports[0].CallingConvention -ne [System.Runtime.InteropServices.CallingConvention]::Winapi -or
      -not $imports[0].SetLastError -or -not $imports[0].ExactSpelling -or
      -not $imports[0].PreserveSig -or
      ($Method.GetMethodImplementationFlags() -band
        [System.Reflection.MethodImplAttributes]::PreserveSig) -eq 0) {
    throw 'stream native import invalid'
  }
}

[void](Assert-ClosedPInvokeRuntimeMethod $findFirstStream 'FindFirstStreamW' ([IntPtr])
  ([Type[]]@([String], [Int32], $streamDataType.MakeByRefType(), [UInt32]))
  ([System.Runtime.InteropServices.CharSet]::Unicode))
[void](Assert-ClosedPInvokeRuntimeMethod $findNextStream 'FindNextStreamW' ([Boolean])
  ([Type[]]@([IntPtr], $streamDataType.MakeByRefType()))
  ([System.Runtime.InteropServices.CharSet]::Unicode))
[void](Assert-ClosedPInvokeRuntimeMethod $findClose 'FindClose' ([Boolean])
  ([Type[]]@([IntPtr])) ([System.Runtime.InteropServices.CharSet]::None))
# DEEP_WORK_TYPE_AUTHENTICATION_END
# DEEP_WORK_PINVOKE_SOURCE_END

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
  $data = [Activator]::CreateInstance($streamDataType)
  $firstArguments = [Object[]]@($LiteralPath, [Int32]0, $data, [UInt32]0)
  $handle = [IntPtr]$findFirstStream.Invoke($null, $firstArguments)
  $data = $firstArguments[2]
  $invalidHandle = [IntPtr]::new(-1)
  if ($handle -eq $invalidHandle) {
    $code = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
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
      $next = [Activator]::CreateInstance($streamDataType)
      $nextArguments = [Object[]]@($handle, $next)
      $hasNext = [Boolean]$findNextStream.Invoke($null, $nextArguments)
      $next = $nextArguments[1]
      if (-not $hasNext) {
        $code = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
        if ($code -ne 38) { throw "FindNextStreamW failed with Win32 error $code" }
        break
      }
      $data = $next
    }
  } finally {
    if (-not [Boolean]$findClose.Invoke($null, [Object[]]@($handle))) {
      $code = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
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
