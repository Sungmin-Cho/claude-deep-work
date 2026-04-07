# SOLID Design Principles — Universal Review Checklist

## Purpose

This guide provides framework-agnostic checklists for evaluating code against the 5 SOLID principles. The reviewer (Claude) should interpret these criteria in the context of the target code's language and framework — no framework-specific rules are needed.

## Principles

### S — Single Responsibility Principle (SRP)

**Definition**: A class/module should have only one reason to change.

**Violation Signals**:
- Unrelated methods coexisting in a single class/module
- Main method (main, update, run, handle, etc.) exceeds 30 lines
- Class names with generic suffixes: "Manager", "Handler", "Processor", "Utils"
- Constructor/init injects 5+ unrelated dependencies
- Changing one file breaks multiple unrelated tests

**Severity**:
- **Violation**: 3+ independent responsibilities in one class
- **Improvement Recommended**: 2 responsibilities mixed but small scope
- **Compliant**: Single clear responsibility, or class too small to split

**Refactoring Direction**: Split by responsibility, connect via Composition

---

### O — Open/Closed Principle (OCP)

**Definition**: Open for extension, closed for modification.

**Violation Signals**:
- Adding a new case requires modifying existing if-else/switch blocks
- Similar conditional branches repeated across multiple methods
- Branching logic based on type strings/enums
- Adding new functionality requires editing existing classes

**Severity**:
- **Violation**: 3+ branch cases with expected future additions
- **Improvement Recommended**: 2 cases with potential for growth
- **Compliant**: Fixed branches, or handled via interfaces/abstractions

**Refactoring Direction**: Strategy pattern, interface extraction, polymorphism

---

### L — Liskov Substitution Principle (LSP)

**Definition**: Derived classes must be fully substitutable for their base classes.

**Violation Signals**:
- Override methods with `throw NotImplementedException()` / `pass` / `return null`
- Strengthening or weakening parent method pre/post conditions
- `instanceof` / `is` / `typeof` checks with downcasting
- Inheritance where IS-A relationship doesn't hold (Square extends Rectangle)

**Severity**:
- **Violation**: NotImplementedException exists, or downcasting is essential
- **Improvement Recommended**: Awkward inheritance but currently works
- **Compliant**: No inheritance hierarchy, or correct polymorphism applied

**Refactoring Direction**: Inheritance to Composition, interface segregation

---

### I — Interface Segregation Principle (ISP)

**Definition**: Clients should not be forced to implement methods they don't use.

**Violation Signals**:
- Interface/abstract class with 5+ methods
- Implementations with empty method bodies (`{}`, `pass`, `return null`)
- "God interface" defining multiple unrelated capabilities
- Clients only calling a subset of interface methods

**Severity**:
- **Violation**: Empty method implementations exist
- **Improvement Recommended**: Large interface but all implementors use everything
- **Compliant**: Small, cohesive interfaces, or no interfaces used

**Refactoring Direction**: Split large interfaces by role

---

### D — Dependency Inversion Principle (DIP)

**Definition**: High-level modules should not depend on low-level modules. Both should depend on abstractions.

**Violation Signals**:
- `new ConcreteClass()` for core dependencies inside a class
- Direct references to external services (DB, API, filesystem)
- Module imports referencing concrete classes (no interface layer)
- Structure that makes mock/stub testing impossible

**Severity**:
- **Violation**: Core business logic directly depends on infrastructure
- **Improvement Recommended**: Utility-level direct dependencies (logger, config)
- **Compliant**: Dependencies via interfaces/abstractions, or script too simple to need it

**Refactoring Direction**: Interface extraction, constructor/method injection, Factory pattern

---

## KISS Balance

Blindly applying SOLID leads to over-engineering. Allow violations when:

- **Small projects/scripts**: No need for DIP in files under 50 lines
- **Prototypes/PoC**: Speed over design refinement
- **Code that won't change**: Utilities with no extension plans
- **Framework-imposed structure**: Framework conventions override SOLID

**Decision criterion**: "Would fixing this violation actually make the code easier to maintain?" If No, mark as Compliant.
