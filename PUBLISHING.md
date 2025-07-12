# Publishing Guide

## Prerequisites
- npm account with publishing permissions
- Verified email address
- 2FA enabled (recommended)

## Publishing Steps

### 1. Final Testing
```bash
# Build and test locally
npm run build
npm link
codeprompt --help

# Test the package structure
npm pack --dry-run
```

### 2. Version Management
```bash
# For patch updates (1.0.0 -> 1.0.1)
npm version patch

# For minor updates (1.0.0 -> 1.1.0)
npm version minor

# For major updates (1.0.0 -> 2.0.0)
npm version major
```

### 3. Publish to npm
```bash
# Login to npm (if not already logged in)
npm login

# Publish the package
npm publish

# For first-time publishing or if you need to specify access
npm publish --access public
```

### 4. Verify Publication
```bash
# Check on npm website
# https://www.npmjs.com/package/codeprompt-cli

# Test installation
npm install -g codeprompt-cli
codeprompt --help
```

## Post-Publishing Checklist

- [ ] Update README badges with correct npm version
- [ ] Create GitHub release with changelog
- [ ] Update documentation if needed
- [ ] Announce on social media/developer communities
- [ ] Monitor for issues and user feedback

## Version History

- **1.0.0**: Initial release
  - Interactive mode with conversation persistence
  - Multiple LLM providers (OpenAI, Anthropic)
  - Advanced file tools (diff edits, checkpoints, search)
  - Smart directory filtering
  - Retry logic with exponential backoff
  - Complete conversation management

## Future Roadmap

- Plugin system for custom tools
- More LLM providers (Llama, Gemini)
- Web interface option
- Team collaboration features
- Custom prompt templates
- Integration with popular IDEs