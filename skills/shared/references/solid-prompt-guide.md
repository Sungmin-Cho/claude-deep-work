# SOLID-Aware AI Prompt Guide

## Purpose

AI code generation tools tend to produce code with predictable SOLID violations. This guide helps request SOLID-compliant code from AI and verify AI output against SOLID principles.

## Common AI SOLID Violation Patterns

| Request | AI Default Output | SOLID Violation | Fix |
|---------|------------------|-----------------|-----|
| "Create a character" | Monolithic class | SRP | Add "separate each responsibility" |
| "Add new feature" | Add condition to if-else | OCP | Add "extensible via interface" |
| "Implement with inheritance" | Mechanical inheritance | LSP | Add "verify IS-A relationship" |
| "Create an interface" | God interface | ISP | Add "split by role" |
| "Create a service class" | new SpecificClass() | DIP | Add "depend on interfaces" |

## SOLID Prompt Template

### Basic Template

Implement the following feature: [description]

Constraints:
- Each class should have a single responsibility (SRP)
- New features should be addable without modifying existing code (OCP)
- Depend on interfaces, not concrete classes (DIP)
- Interfaces should be split by role (ISP)

### Usage in deep-work plan.md

Include SOLID constraints in the plan's design guidelines section:

```markdown
## Design Guidelines
- [ ] Each new class has a single responsibility (SRP)
- [ ] Extension points defined via interfaces (OCP)
- [ ] Core dependencies abstracted via interfaces (DIP)
```

## AI Output SOLID Verification Checklist

Quick checks after AI generates code:

1. **SRP Check**: Count "reasons to change" for each class/module. If 2+, split candidate.
2. **OCP Check**: "To add a new type here, what existing code must I modify?" If any, violation.
3. **LSP Check**: Search for `throw NotImplementedException()`. If found, review inheritance.
4. **ISP Check**: Any interface methods with empty implementations?
5. **DIP Check**: Is `new` keyword used to create core dependencies directly?
