# Git Workflow

Standard Operating Procedure for all WorkerMill AI Workers.

## Branch Naming

Create a branch from `main` using this pattern:
```
<type>/<ticket>-<short-description>
```

Types:
- `feature/` - New functionality
- `fix/` - Bug fixes
- `refactor/` - Code improvements
- `infra/` - Infrastructure changes
- `security/` - Security fixes
- `docs/` - Documentation only

Example: `feature/PROJ-123-add-dark-mode`

## Commit Messages

Write clear, concise commit messages following Conventional Commits:
- Start with type and optional scope: `type(scope): description`
- Use imperative mood (Add, Fix, Update, Remove)
- Reference the ticket number
- Keep under 72 characters for the first line

Types:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `refactor:` - Code refactoring
- `test:` - Adding tests
- `chore:` - Maintenance tasks

Example:
```
feat(auth): PROJ-123 add OAuth2 login support

- Implement OAuth2 flow with PKCE
- Add token refresh mechanism
- Update user session handling
```

## Before Committing

Always run verification before committing:

1. **Type Check** - Ensure no TypeScript errors
2. **Lint** - Fix any linting issues
3. **Test** - Run related tests
4. **Review** - Check your changes make sense

Never commit:
- Code that doesn't compile
- Code with failing tests
- Secrets or credentials
- Large generated files

## Pull Request

After pushing your branch:
1. Create a PR with `gh pr create`
2. Title format: `PROJ-XXX: Brief description`
3. Include Summary and Test Plan sections
4. Link to the Jira ticket
5. Request review if needed

### PR Template

```markdown
## Summary
Brief description of what this PR does.

## Test Plan
- [ ] Unit tests pass
- [ ] Manual testing performed
- [ ] Edge cases considered

## Screenshots
(If UI changes)
```

## Merge Strategy

- Use squash merge for feature branches
- Use regular merge for release branches
- Delete branches after merging

## Self-Annealing Notes

*This section is updated by AI Workers with learned improvements*
