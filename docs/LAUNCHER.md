# BitsBy8 Serial Drive Server - Launcher Script Usage

## 🚀 Quick Start

The `bitsby8.sh` launcher script makes it easy to run the server.

### **Basic Usage**

```bash
./bitsby8.sh -p /dev/cu.usbserial-114110 -0 disks/test.dsk
```

---

## 📋 Script Modes

### **1. Production Mode (Default)**
Runs the compiled JavaScript (fastest):
```bash
./bitsby8.sh -p /dev/cu.usbserial-114110 -0 disks/test.dsk
```

### **2. Development Mode**
Runs TypeScript directly with ts-node (for development):
```bash
./bitsby8.sh --dev -p /dev/cu.usbserial-114110 -0 disks/test.dsk
```

### **3. Rebuild Mode**
Forces a fresh build before running:
```bash
./bitsby8.sh --rebuild -p /dev/cu.usbserial-114110 -0 disks/test.dsk
```

---

## 🎯 Examples

### **Mount a Single Disk**
```bash
./bitsby8.sh -p /dev/cu.usbserial-114110 -0 disks/test.dsk
```

### **Mount Multiple Disks**
```bash
./bitsby8.sh \
  -p /dev/cu.usbserial-114110 \
  -0 disks/cpm22.dsk \
  -1 disks/altdos.dsk \
  -2 disks/basic.dsk
```

### **Read-Only Drive**
```bash
./bitsby8.sh -p /dev/cu.usbserial-114110 -0 disks/cpm22.dsk -r 0
```

### **Custom Baud Rate**
```bash
./bitsby8.sh -p /dev/cu.usbserial-114110 -b 460800 -0 disks/test.dsk
```

### **Verbose Mode**
```bash
./bitsby8.sh -p /dev/cu.usbserial-114110 -0 disks/test.dsk -v
```

### **Debug Mode**
```bash
./bitsby8.sh -p /dev/cu.usbserial-114110 -0 disks/test.dsk -v -d
```

### **Development Mode (Live Reload)**
```bash
./bitsby8.sh --dev -p /dev/cu.usbserial-114110 -0 disks/test.dsk
```

---

## ⚙️ Automatic Setup

The script automatically:
- ✅ Checks for Node.js 18+
- ✅ Installs dependencies if missing (`npm install`)
- ✅ Builds the project if needed (`npm run build`)
- ✅ Runs the appropriate version (dev or production)

---

## 🔧 Installation Options

### **Option 1: Run from Project Directory**
```bash
cd /Users/mreppot/src/fdcplus-web
./bitsby8.sh -p /dev/cu.usbserial-114110 -0 disks/test.dsk
```

### **Option 2: Add to PATH**

Add to your `~/.bashrc` or `~/.zshrc`:
```bash
export PATH="/Users/mreppot/src/fdcplus-web:$PATH"
```

Then reload your shell:
```bash
source ~/.bashrc  # or source ~/.zshrc
```

Now run from anywhere:
```bash
bitsby8.sh -p /dev/cu.usbserial-114110 -0 disks/test.dsk
```

### **Option 3: Create Symlink in /usr/local/bin**
```bash
sudo ln -s /Users/mreppot/src/fdcplus-web/bitsby8.sh /usr/local/bin/bitsby8
```

Then run from anywhere:
```bash
bitsby8 -p /dev/cu.usbserial-114110 -0 disks/test.dsk
```

### **Option 4: Create Shell Alias**

Add to your `~/.bashrc` or `~/.zshrc`:
```bash
alias bitsby8='/Users/mreppot/src/fdcplus-web/bitsby8.sh'
```

Reload and use:
```bash
bitsby8 -p /dev/cu.usbserial-114110 -0 disks/test.dsk
```

---

## 🛠️ Troubleshooting

### **Script Not Executable**
```bash
chmod +x bitsby8.sh
```

### **Node.js Not Found**
Install Node.js 18+ from https://nodejs.org/

### **Dependencies Missing**
The script auto-installs, but you can manually run:
```bash
npm install
```

### **Build Failed**
Try a clean rebuild:
```bash
npm run clean
npm run build
```

Or use the rebuild flag:
```bash
./bitsby8.sh --rebuild -p /dev/cu.usbserial-114110 -0 disks/test.dsk
```

### **Serial Port Permission Denied**

**On macOS:**
```bash
# Check port exists
ls -l /dev/cu.usbserial-*

# Usually no permission issues on macOS
```

**On Linux:**
```bash
# Add user to dialout group
sudo usermod -a -G dialout $USER

# Log out and back in, then verify
groups

# Or run with sudo (not recommended)
sudo ./bitsby8.sh -p /dev/ttyUSB0 -0 disks/test.dsk
```

---

## 📚 Help & Documentation

### **Show Help**
```bash
./bitsby8.sh -h
```

### **Show Version**
```bash
./bitsby8.sh --version
```

### **Check Node.js Version**
```bash
node -v
```

Should show v18 or higher.

---

## 🎮 Interactive Controls

Once running:
- **Q** - Quit server
- **C** - Clear error messages
- **V** - Toggle verbose mode

---

## 📊 Script Features

✅ **Smart Mode Selection**
   - Default: Production (compiled)
   - `--dev`: Development (ts-node)
   - `--rebuild`: Force rebuild

✅ **Automatic Setup**
   - Checks Node.js version
   - Installs dependencies
   - Builds project if needed

✅ **Colored Output**
   - Green: Success messages
   - Yellow: Warnings
   - Red: Errors

✅ **Error Handling**
   - Node.js version check
   - Dependency installation
   - Build failure detection

---

## 🔄 Comparison: Script vs npm Commands

| Task | Shell Script | npm Command |
|------|-------------|-------------|
| Run production | `./bitsby8.sh -p ...` | `npm start -- -p ...` |
| Run development | `./bitsby8.sh --dev -p ...` | `npm run dev -- -p ...` |
| Force rebuild | `./bitsby8.sh --rebuild -p ...` | `npm run build && npm start -- -p ...` |
| Auto-install deps | ✅ Automatic | ❌ Manual `npm install` |
| Auto-build | ✅ Automatic | ❌ Manual `npm run build` |
| Shorter command | ✅ Yes | ❌ Longer |

---

## 💡 Pro Tips

1. **Use TAB completion** for file paths
   ```bash
   ./bitsby8.sh -p /dev/cu.usb<TAB> -0 disks/test<TAB>
   ```

2. **Find serial ports quickly**
   ```bash
   ./bitsby8.sh -p $(ls /dev/cu.usbserial-* | head -1) -0 disks/test.dsk
   ```

3. **Create a test script**
   ```bash
   cat > test-server.sh <<'EOF'
   #!/bin/bash
   ./bitsby8.sh -p /dev/cu.usbserial-114110 -0 disks/test.dsk -v
   EOF
   chmod +x test-server.sh
   ./test-server.sh
   ```

4. **Use with watch for auto-restart during development**
   ```bash
   # Install watchexec: brew install watchexec
   watchexec -r -e ts './bitsby8.sh --dev -p /dev/cu.usbserial-114110 -0 disks/test.dsk'
   ```

---

## 📝 Advanced Usage

### **Run in Background**
```bash
./bitsby8.sh -p /dev/cu.usbserial-114110 -0 disks/test.dsk > server.log 2>&1 &
echo $! > server.pid
```

### **Stop Background Server**
```bash
kill $(cat server.pid)
```

### **Check if Running**
```bash
ps aux | grep bitsby8
```

### **Monitor Logs**
```bash
tail -f server.log
```

---

For more information, see README-TS.md
