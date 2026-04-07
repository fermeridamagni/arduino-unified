# Security Policy

## 🔒 Reporting Security Vulnerabilities

The Arduino Unified team takes security seriously. We appreciate your efforts to responsibly disclose your findings and will make every effort to acknowledge your contributions.

### ⚠️ Please Do Not

- **Do not** open a public GitHub issue for security vulnerabilities
- **Do not** disclose the vulnerability publicly until it has been addressed
- **Do not** exploit the vulnerability beyond what is necessary to demonstrate it

### ✅ Please Do

**Report security vulnerabilities via GitHub Security Advisories:**

1. Go to the [Security tab](https://github.com/fermeridamagni/arduino-unified/security) of this repository
2. Click "Report a vulnerability"
3. Fill out the vulnerability report form with as much detail as possible

**Or send an email to:** [Your security contact email - to be added]

### 📋 What to Include in Your Report

To help us understand and address the issue quickly, please include:

1. **Description**: Clear description of the vulnerability
2. **Impact**: What an attacker could achieve by exploiting this
3. **Affected versions**: Which versions of the extension are affected
4. **Steps to reproduce**: Detailed steps to reproduce the vulnerability
5. **Proof of concept**: Code or screenshots demonstrating the issue
6. **Suggested fix**: If you have ideas on how to fix it (optional)
7. **Your contact information**: For follow-up questions

### Example Report

```
**Vulnerability Type**: Remote Code Execution

**Description**: 
The extension executes user-provided board manager URLs without validation,
potentially allowing execution of arbitrary code.

**Impact**: 
An attacker could craft a malicious board manager URL that executes code
when the extension fetches and parses the JSON index.

**Affected Versions**: 
All versions up to and including 0.0.1

**Steps to Reproduce**:
1. Open VS Code settings
2. Add a malicious URL to arduinoUnified.boardManager.additionalUrls
3. Trigger board manager index update
4. Observe code execution

**Proof of Concept**:
[Attach code or screenshot]

**Suggested Fix**:
Validate and sanitize all URLs before fetching. Use a whitelist of
allowed protocols (https only) and validate JSON structure.
```

---

## 🛡️ Security Best Practices for Users

### Safe Configuration

#### ✅ Safe Board Manager URLs

Only add board manager URLs from trusted sources:

```json
{
  "arduinoUnified.boardManager.additionalUrls": [
    // Official ESP32 (Espressif)
    "https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json",
    
    // Official ESP8266
    "http://arduino.esp8266.com/stable/package_esp8266com_index.json",
    
    // Official STM32
    "https://github.com/stm32duino/BoardManagerFiles/raw/main/package_stmicroelectronics_index.json"
  ]
}
```

**⚠️ Warning:** Adding untrusted board manager URLs can expose your system to security risks.

#### ✅ Custom Binary Paths

If providing a custom Arduino CLI path:

```json
{
  "arduinoUnified.cli.path": "/usr/local/bin/arduino-cli"
}
```

**Ensure:**
- The binary is from a trusted source (official Arduino releases)
- The binary has not been tampered with
- File permissions are appropriate (not world-writable)

### Arduino CLI Security

The extension uses the official Arduino CLI binary. To verify its authenticity:

1. **Check the download source**: https://github.com/arduino/arduino-cli/releases
2. **Verify checksums**: Compare SHA256 hash with official release
3. **Use HTTPS**: The extension only downloads via HTTPS

### Network Security

The extension communicates with:
- **localhost only** - gRPC daemon runs on 127.0.0.1
- **Arduino package servers** - For board/library indexes (HTTPS)
- **GitHub Releases** - For downloading Arduino CLI (HTTPS)

**No data is sent to 3rd-party servers** except:
- Board manager index fetches (from configured URLs)
- Library searches (via Arduino CLI to official index)
- Arduino CLI downloads (from GitHub Releases)

### Permissions

The extension requires permissions to:
- **File system access** - Read/write sketches, Arduino configuration
- **Process spawning** - Launch Arduino CLI daemon, upload tools
- **Network access** - Download Arduino CLI, fetch board/library indexes
- **Serial port access** - Communicate with connected Arduino boards

---

## 🔐 Security Features

### Sandboxing

- **Arduino CLI daemon** runs as a separate process (isolated from VS Code)
- **gRPC communication** is limited to localhost (no external access)
- **Sketch compilation** runs in Arduino CLI's sandboxed environment

### Input Validation

The extension validates:
- ✅ Board manager URLs (protocol checks)
- ✅ File paths (prevent directory traversal)
- ✅ Serial port names (prevent command injection)
- ✅ gRPC port numbers (valid range)

### Dependency Security

Dependencies are:
- Regularly updated to patch vulnerabilities
- Scanned for known CVEs
- Kept to a minimum (only 2 runtime dependencies)

Current runtime dependencies:
- `@grpc/grpc-js` - gRPC client (maintained by Google)
- `@grpc/proto-loader` - Protocol buffer loader (maintained by Google)

---

## 📦 Supply Chain Security

### Package Integrity

The extension is:
- Built from source in a clean environment
- Signed and verified by the VS Code Marketplace
- Distributed only through official channels

### Third-Party Components

The extension bundles:
1. **Arduino CLI Protocol Buffers** (Apache 2.0) - From official arduino-cli repo
2. **Google Protocol Buffers** (BSD 3-Clause) - Standard Google protobuf definitions

Both are from trusted, verified sources and are included in source form (`.proto` files).

---

## 🚨 Known Security Considerations

### 1. Code Execution via Arduino CLI

**Nature**: The extension executes the Arduino CLI binary, which can compile and upload code to hardware.

**Mitigation**:
- Only official Arduino CLI binaries are used
- SHA256 checksums verified on download
- Users can inspect sketches before compilation

**Risk Level**: Low (inherent to Arduino development)

### 2. Serial Port Access

**Nature**: The extension reads/writes to serial ports to communicate with Arduino boards.

**Mitigation**:
- User explicitly selects ports
- No automatic execution of serial commands
- Serial data is not interpreted as commands

**Risk Level**: Low (standard Arduino workflow)

### 3. Third-Party Board Packages

**Nature**: Users can install 3rd-party board packages (ESP32, STM32, etc.) that include compilation tools.

**Mitigation**:
- Only used from user-configured board manager URLs
- Arduino CLI handles package verification
- Users must explicitly install packages

**Risk Level**: Medium (depends on package source trustworthiness)

**Recommendation**: Only use board packages from official manufacturer sources.

---

## 🔄 Security Update Process

When a security vulnerability is reported:

1. **Acknowledgment** - Within 48 hours
2. **Assessment** - Severity evaluation (Critical, High, Medium, Low)
3. **Fix development** - Patch created and tested
4. **Security advisory** - Published on GitHub Security Advisories
5. **Release** - Patched version released to VS Code Marketplace
6. **Notification** - Users notified via GitHub Security Advisory
7. **Disclosure** - Full details published after patched version is widely adopted

### Timeline Goals

- **Critical vulnerabilities**: Patch within 7 days
- **High severity**: Patch within 30 days
- **Medium/Low severity**: Patch in next regular release

---

## 📊 Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.0.x   | :white_check_mark: |

Only the latest version receives security updates. Please update to the latest version to ensure you have the latest security patches.

---

## 🏆 Security Hall of Fame

We recognize and thank security researchers who have responsibly disclosed vulnerabilities:

- *[Your name could be here!]*

---

## 📚 Additional Resources

- [VS Code Extension Security](https://code.visualstudio.com/api/references/extension-manifest#extension-security)
- [Arduino CLI Security](https://arduino.github.io/arduino-cli/)
- [OWASP Secure Coding Practices](https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/)

---

## 📬 Questions?

If you have questions about this security policy or the security of Arduino Unified:

- **GitHub Discussions**: [Security topic](https://github.com/fermeridamagni/arduino-unified/discussions)
- **Email**: [Security contact - to be added]

---

**Thank you for helping keep Arduino Unified and its users safe!** 🙏
