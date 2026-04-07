# Publishing Arduino Unified to VS Code Marketplace

This guide explains how to publish Arduino Unified to both the VS Code Marketplace and Open VSX Registry.

## Prerequisites

### 1. Create a VS Code Marketplace Personal Access Token (PAT)

1. Go to [Azure DevOps](https://dev.azure.com/)
2. Sign in with your Microsoft account
3. Click on **User Settings** → **Personal Access Tokens**
4. Click **New Token**
5. Configure:
   - **Name**: `vscode-marketplace-arduino-unified`
   - **Organization**: All accessible organizations
   - **Expiration**: Custom (set to 1 year or more)
   - **Scopes**: Select **Marketplace** → **Manage**
6. Click **Create** and **copy the token** (you won't see it again!)

### 2. Create an Open VSX Registry Personal Access Token

1. Go to [Open VSX Registry](https://open-vsx.org/)
2. Sign in with GitHub
3. Click on your profile → **Access Tokens**
4. Click **New Access Token**
5. Give it a name: `arduino-unified-publisher`
6. Click **Create**
7. **Copy the token** (you won't see it again!)

### 3. Add Tokens to GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add two secrets:
   - **Name**: `VSCE_PAT`, **Value**: Your VS Code Marketplace PAT
   - **Name**: `OVSX_PAT`, **Value**: Your Open VSX Registry PAT

## Publishing Process

### Automatic Publishing (Recommended)

The extension is automatically published when you create a new GitHub release:

1. **Update the version** in `package.json`:
   ```bash
   # For example, updating to v1.0.0
   npm version 1.0.0 --no-git-tag-version
   ```

2. **Update CHANGELOG.md** with the new version's changes

3. **Commit the changes**:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore: bump version to 1.0.0"
   git push origin main
   ```

4. **Create a Git tag**:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

5. **Create a GitHub Release**:
   - Go to your repository on GitHub
   - Click **Releases** → **Create a new release**
   - Choose the tag you just created (`v1.0.0`)
   - Add a title: `v1.0.0` or `Version 1.0.0 - Feature Name`
   - Add release notes (can copy from CHANGELOG.md)
   - For stable releases: Leave **Set as a pre-release** unchecked
   - For beta/alpha: Check **Set as a pre-release**
   - Click **Publish release**

6. **Monitor the workflow**:
   - Go to **Actions** tab in your repository
   - Watch the "Publish Extension" workflow run
   - It will:
     - Build the extension
     - Run tests and linting
     - Publish to VS Code Marketplace
     - Publish to Open VSX Registry
     - Upload the `.vsix` file to the release

### Manual Publishing (For Testing)

If you need to publish manually:

```bash
# Install vsce
npm install -g @vscode/vsce

# Install ovsx
npm install -g ovsx

# Build the extension
pnpm run package

# Package the extension
vsce package

# Publish to VS Code Marketplace
vsce publish -p YOUR_VSCE_PAT

# Publish to Open VSX
ovsx publish -p YOUR_OVSX_PAT
```

## Version Numbering

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0): Breaking changes
- **MINOR** (0.1.0): New features, backwards compatible
- **PATCH** (0.0.1): Bug fixes, backwards compatible

Examples:
- `1.0.0` - First stable release
- `1.1.0` - Add new serial plotter feature
- `1.1.1` - Fix compilation error bug
- `2.0.0` - Change configuration structure (breaking)

For pre-releases:
- `1.0.0-beta.1` - Beta version
- `1.0.0-alpha.1` - Alpha version
- `1.0.0-rc.1` - Release candidate

## Pre-Release Publishing

To publish a pre-release version:

1. Update version with pre-release suffix:
   ```bash
   npm version 1.1.0-beta.1 --no-git-tag-version
   ```

2. Create a release and **check "Set as a pre-release"**

3. The workflow will automatically use `--pre-release` flag for VS Code Marketplace

## Verifying Publication

After publishing:

1. **VS Code Marketplace**:
   - Visit: https://marketplace.visualstudio.com/items?itemName=fermeridamagni.arduino-unified
   - Check version is updated
   - Test installation: `code --install-extension fermeridamagni.arduino-unified`

2. **Open VSX**:
   - Visit: https://open-vsx.org/extension/fermeridamagni/arduino-unified
   - Check version is updated

3. **GitHub Release**:
   - Check the `.vsix` file is attached to the release

## Troubleshooting

### "Version already exists"

- You cannot republish the same version
- Increment the version number in `package.json`
- Create a new release with the new version

### "Invalid Personal Access Token"

- Check the token has **Marketplace: Manage** permissions (for VSCE_PAT)
- Check the token hasn't expired
- Regenerate the token and update the GitHub secret

### "Publisher not found"

- Make sure you've created a publisher on the marketplace
- Your `package.json` must have `"publisher": "fermeridamagni"`
- For first-time publishing, you may need to manually create the publisher at:
  - [VS Code Marketplace](https://marketplace.visualstudio.com/manage)

### Build Fails

- Check the GitHub Actions logs for specific errors
- Run `pnpm run check` locally to catch linting issues
- Run `pnpm run package` locally to test the build

## Publishing Checklist

Before creating a release:

- [ ] Update version in `package.json`
- [ ] Update `CHANGELOG.md` with changes
- [ ] Run `pnpm run check` (linting)
- [ ] Run `pnpm run test` (tests)
- [ ] Run `pnpm run package` (build)
- [ ] Test the extension locally
- [ ] Commit and push changes
- [ ] Create and push git tag
- [ ] Create GitHub release
- [ ] Monitor workflow execution
- [ ] Verify publication on both marketplaces
- [ ] Test installation from marketplace

## First-Time Setup

For the very first publication:

1. **Create a Publisher** on [VS Code Marketplace](https://marketplace.visualstudio.com/manage):
   - Publisher ID: `fermeridamagni` (must match `package.json`)
   - Publisher name: Your display name
   - Verify email

2. **Verify Publisher** on [Open VSX](https://open-vsx.org/):
   - Sign in with GitHub
   - Create a namespace matching your publisher ID

3. **Manual First Publish** (if needed):
   ```bash
   vsce publish -p YOUR_VSCE_PAT
   ovsx publish -p YOUR_OVSX_PAT
   ```

4. After first manual publish, all subsequent versions can use the automated workflow

## Resources

- [VS Code Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Open VSX Publishing](https://github.com/eclipse/openvsx/wiki/Publishing-Extensions)
- [Semantic Versioning](https://semver.org/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
