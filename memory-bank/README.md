# Discord Anti-Spam Bot: Memory Bank

This directory serves as the Memory Bank for the Discord Anti-Spam Bot project. It contains documentation that provides comprehensive context about the project, its architecture, current status, and future plans.

## Purpose

The Memory Bank is designed to maintain perfect documentation of the project, ensuring that anyone (including Roo) can understand the project's context, current state, and next steps at any time. This is particularly important as Roo's memory resets between sessions, making these documents the primary source of project knowledge.

## Core Files

The Memory Bank follows a hierarchical structure where files build upon each other:

1. **projectbrief.md**
   - Foundation document that shapes all other files
   - Defines core requirements and goals
   - Source of truth for project scope

2. **productContext.md**
   - Why this project exists
   - Problems it solves
   - How it should work
   - User experience goals

3. **systemPatterns.md**
   - System architecture
   - Key technical decisions
   - Design patterns in use
   - Component relationships

4. **techContext.md**
   - Technologies used
   - Development setup
   - Technical constraints
   - Dependencies

5. **activeContext.md**
   - Current work focus
   - Recent changes
   - Next steps
   - Active decisions and considerations

6. **progress.md**
   - What works
   - What's left to build
   - Current status
   - Known issues

7. **.clinerules**
   - Project intelligence
   - Learned patterns and preferences
   - Implementation insights
   - Development workflow

## Usage Guidelines

- **Reading Order**: For a complete understanding of the project, read the files in the order listed above
- **Updates**: Files should be updated when:
  - Completing significant features
  - Making architectural changes
  - Shifting development focus
  - Discovering new patterns or insights
- **Consistency**: Ensure information is consistent across all files
- **Completeness**: Each file should be comprehensive within its domain

## Maintenance

The Memory Bank should be maintained with precision and clarity, as it serves as the primary source of project knowledge. When updating files:

1. Review all related files to ensure consistency
2. Update the most specific file first, then propagate changes to more general files if needed
3. Keep the `.clinerules` file updated with new insights and patterns
4. Ensure `activeContext.md` and `progress.md` accurately reflect the current state

## Additional Context

As the project evolves, additional files or folders may be added to the Memory Bank to organize:
- Complex feature documentation
- Integration specifications
- API documentation
- Testing strategies
- Deployment procedures

These should be referenced from the core files to maintain the hierarchical structure.