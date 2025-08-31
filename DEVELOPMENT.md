# Development Guide

## Local Testing

### 1. Link the package locally
```bash
# In the dropcaster directory
npm link

# Test in another directory
mkdir test-project
cd test-project
npm link dropcaster
```

### 2. Test with npx from GitHub
```bash
# Run directly from GitHub
npx github:yourusername/dropcaster init my-gallery

# Or from a specific branch
npx github:yourusername/dropcaster#feature-branch init my-gallery
```

### 3. Install from GitHub for testing
```bash
# Global install from GitHub
npm install -g github:yourusername/dropcaster

# Local project install
npm install github:yourusername/dropcaster
```

## Release Checklist

Before publishing to npm, ensure:

- [ ] All core features are working
- [ ] Documentation is complete
- [ ] Tests are passing
- [ ] No hardcoded paths or credentials
- [ ] Example projects work correctly
- [ ] CLI commands are tested
- [ ] Build process is stable
- [ ] Error handling is implemented
- [ ] Package.json metadata is correct
- [ ] LICENSE file exists

## Version Strategy

- `0.x.x` - Development/Beta (breaking changes allowed)
- `1.0.0` - First stable release
- Follow [Semantic Versioning](https://semver.org/) after 1.0.0

## Testing Workflow

1. Make changes
2. Run `npm link` to update local link
3. Test in a separate project
4. Iterate until stable
5. Consider beta release for wider testing
6. Release stable version when ready