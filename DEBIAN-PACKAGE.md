# Debian Package Installation Guide

This guide explains how to build and install the FDC+ Serial Drive Server as a Debian package on Raspbian/Raspberry Pi OS.

## Table of Contents

- [Overview](#overview)
- [Building the Package](#building-the-package)
- [Installing the Package](#installing-the-package)
- [Configuration](#configuration)
- [Service Management](#service-management)
- [File Locations](#file-locations)
- [Upgrading](#upgrading)
- [Removing](#removing)
- [Troubleshooting](#troubleshooting)

---

## Overview

The Debian package provides:

- **Automated installation** via `dpkg` or `apt`
- **systemd service** for automatic startup
- **Default configuration** files
- **System user** with proper permissions
- **Sample disk images** for testing
- **Complete documentation**

### Package Details

- **Package Name:** `fdcsds`
- **Version:** 2.0.0-1
- **Architecture:** all (platform-independent)
- **Dependencies:** nodejs (>= 18.0.0)

---

## Building the Package

### Prerequisites

Install build tools on your Raspberry Pi or Debian system:

```bash
sudo apt-get update
sudo apt-get install -y build-essential debhelper devscripts nodejs npm
```

Or use the provided Makefile:

```bash
make install-build-deps
```

### Build Steps

1. **Clone or navigate to the source directory:**

```bash
cd /path/to/fdcplus-web
```

2. **Validate packaging files (optional):**

```bash
make validate
```

3. **Build the Debian package:**

```bash
make deb
```

Or manually:

```bash
dpkg-buildpackage -us -uc -b
```

This will:
- Install Node.js dependencies
- Compile TypeScript to JavaScript
- Create the `.deb` package in the parent directory

4. **Verify the build:**

```bash
ls -lh ../fdcsds_*.deb
```

You should see:
```
../fdcsds_2.0.0-1_all.deb
```

---

## Installing the Package

### Standard Installation

Install the package using `dpkg`:

```bash
sudo dpkg -i ../fdcsds_2.0.0-1_all.deb
```

If there are dependency issues, fix them with:

```bash
sudo apt-get install -f
```

### Quick Install (Build + Install)

Use the Makefile for a one-step build and install:

```bash
make quick-install
```

### Post-Installation

After installation, you'll see a summary message with next steps:

```
======================================================================
  FDC+ Serial Drive Server (fdcsds) has been installed successfully!
======================================================================

Next steps:

1. Edit the configuration file:
   sudo nano /etc/fdcsds/fdcsds.config.json

2. Configure your serial ports and disk images

3. Start the service:
   sudo systemctl start fdcsds

4. Enable automatic startup on boot:
   sudo systemctl enable fdcsds

5. Check service status:
   sudo systemctl status fdcsds

6. View logs:
   sudo journalctl -u fdcsds -f

7. Access the web interface (if enabled):
   http://raspberrypi.local:3000

Documentation: /usr/share/doc/fdcsds/
Sample disk images: /usr/share/fdcsds/disks/
======================================================================
```

---

## Configuration

### Default Configuration File

The main configuration file is located at:

```
/etc/fdcsds/fdcsds.config.json
```

### Default Settings (Raspbian-optimized)

```json
{
  "port": "/dev/ttyUSB0",
  "baud": 230400,
  "drive0": "/usr/share/fdcsds/disks/cpm22.dsk",
  "drive1": null,
  "drive2": null,
  "drive3": null,
  "readonly": [0],
  "verbose": false,
  "debug": false,
  "web": true,
  "webPort": 3000,
  "webHost": "0.0.0.0",
  "terminalPort": "/dev/ttyUSB1",
  "terminalBaud": 9600,
  "terminalAutoconnect": false
}
```

### Editing Configuration

```bash
sudo nano /etc/fdcsds/fdcsds.config.json
```

**Important:** After editing, restart the service:

```bash
sudo systemctl restart fdcsds
```

### Configuration Preservation

The configuration file is marked as a **conffile**, meaning:
- Your changes are preserved during package upgrades
- If the packaged version changes, you'll be prompted to keep or replace your version

### Example Configuration Template

An example configuration is available at:

```
/etc/fdcsds/fdcsds.config.example
```

---

## Service Management

The package includes a systemd service for automatic management.

### Service Commands

**Start the service:**
```bash
sudo systemctl start fdcsds
```

**Stop the service:**
```bash
sudo systemctl stop fdcsds
```

**Restart the service:**
```bash
sudo systemctl restart fdcsds
```

**Check status:**
```bash
sudo systemctl status fdcsds
```

**Enable automatic startup:**
```bash
sudo systemctl enable fdcsds
```

**Disable automatic startup:**
```bash
sudo systemctl disable fdcsds
```

### Viewing Logs

**Real-time logs:**
```bash
sudo journalctl -u fdcsds -f
```

**Recent logs:**
```bash
sudo journalctl -u fdcsds -n 50
```

**Logs since last boot:**
```bash
sudo journalctl -u fdcsds -b
```

### Service User

The service runs as the `fdcsds` system user with:
- Membership in the `dialout` group (for serial port access)
- Home directory: `/var/lib/fdcsds`
- No login shell (security)

---

## File Locations

### Application Files

| Path | Description |
|------|-------------|
| `/usr/bin/fdcsds` | Main executable (symlink) |
| `/usr/lib/fdcsds/` | Application installation directory |
| `/usr/lib/fdcsds/dist/` | Compiled JavaScript |
| `/usr/lib/fdcsds/frontend/dist/` | Web interface files (Svelte build) |
| `/usr/lib/fdcsds/node_modules/` | Node.js dependencies |

### Configuration Files

| Path | Description |
|------|-------------|
| `/etc/fdcsds/fdcsds.config.json` | Main configuration file (conffile) |
| `/etc/fdcsds/fdcsds.config.example` | Example configuration |
| `/etc/default/fdcsds` | Environment variables (conffile) |

### Runtime Files

| Path | Description |
|------|-------------|
| `/var/lib/fdcsds/` | Working directory (owned by fdcsds user) |
| `/var/log/fdcsds/` | Log directory (owned by fdcsds user) |

### Documentation

| Path | Description |
|------|-------------|
| `/usr/share/doc/fdcsds/` | Documentation directory |
| `/usr/share/doc/fdcsds/README.md` | Main documentation |
| `/usr/share/doc/fdcsds/WEB-INTERFACE.md` | Web interface guide |
| `/usr/share/doc/fdcsds/QUICKSTART.md` | Quick start guide |

### Sample Files

| Path | Description |
|------|-------------|
| `/usr/share/fdcsds/disks/` | Sample disk images |

### System Integration

| Path | Description |
|------|-------------|
| `/lib/systemd/system/fdcsds.service` | systemd service unit |

---

## Upgrading

### Upgrade Process

When a new version is released:

1. **Build the new package:**

```bash
cd /path/to/fdcplus-web
git pull
make deb
```

2. **Install the upgrade:**

```bash
sudo dpkg -i ../fdcsds_2.0.1-1_all.deb
```

3. **Review configuration changes (if prompted):**

The installer will ask if you want to keep your existing configuration or use the new default. Choose based on your needs.

4. **Restart the service:**

```bash
sudo systemctl restart fdcsds
```

### Configuration Handling During Upgrade

- Your `/etc/fdcsds/fdcsds.config.json` is preserved
- If the packaged version changes, dpkg will prompt you with options
- Your disk images in `/var/lib/fdcsds/` are never touched

---

## Removing

### Remove Package (Keep Configuration)

```bash
sudo apt-get remove fdcsds
```

This removes the application but keeps:
- Configuration files in `/etc/fdcsds/`
- User data in `/var/lib/fdcsds/`
- The `fdcsds` system user

### Purge (Complete Removal)

```bash
sudo apt-get purge fdcsds
```

This completely removes:
- All application files
- All configuration files
- All user data and logs
- The `fdcsds` system user and group

**Warning:** Purging deletes all your configuration and data. Make backups first!

---

## Troubleshooting

### Package Installation Issues

**Dependency errors:**
```bash
sudo apt-get install -f
```

**Permission errors during build:**
```bash
# Ensure you own the source directory
sudo chown -R $USER:$USER .
```

### Service Won't Start

**Check serial port permissions:**
```bash
ls -l /dev/ttyUSB0
sudo usermod -a -G dialout fdcsds
sudo systemctl restart fdcsds
```

**Check configuration syntax:**
```bash
# Test JSON syntax
python3 -m json.tool /etc/fdcsds/fdcsds.config.json
```

**Check logs:**
```bash
sudo journalctl -u fdcsds -n 50
```

### Serial Port Not Found

**List available serial ports:**
```bash
ls -l /dev/tty* /dev/cu*
```

**For Raspberry Pi:**
- USB serial adapters appear as `/dev/ttyUSB0`, `/dev/ttyUSB1`, etc.
- Built-in UART appears as `/dev/serial0` or `/dev/ttyAMA0`

**Update configuration:**
```bash
sudo nano /etc/fdcsds/fdcsds.config.json
# Change "port" to your actual device
sudo systemctl restart fdcsds
```

### Web Interface Not Accessible

**Check if web interface is enabled:**
```bash
grep '"web"' /etc/fdcsds/fdcsds.config.json
# Should show: "web": true
```

**Check port binding:**
```bash
sudo netstat -tlnp | grep 3000
# Or
sudo ss -tlnp | grep 3000
```

**Check firewall (if enabled):**
```bash
sudo ufw allow 3000/tcp
```

**Access from another device:**
```bash
# Find your Pi's IP address
hostname -I

# Access from browser:
# http://<raspberry-pi-ip>:3000
```

### Node.js Version Issues

**Check Node.js version:**
```bash
node --version
# Should be >= 18.0.0
```

**Install newer Node.js (if needed):**
```bash
# Using NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Package Build Errors

**Clean and rebuild:**
```bash
make distclean
make install-build-deps
make deb
```

**Check build logs:**
```bash
cat debian/*.log
```

### Permission Denied Errors

The `fdcsds` user needs access to serial ports:

```bash
# Verify dialout group membership
groups fdcsds

# Should show: fdcsds : fdcsds dialout

# If not, add manually:
sudo usermod -a -G dialout fdcsds
sudo systemctl restart fdcsds
```

### Disk Image Issues

**Verify disk image paths:**
```bash
ls -l /usr/share/fdcsds/disks/
```

**Use custom disk images:**
```bash
# Copy your images
sudo mkdir -p /var/lib/fdcsds/disks
sudo cp my-disk.dsk /var/lib/fdcsds/disks/
sudo chown fdcsds:fdcsds /var/lib/fdcsds/disks/my-disk.dsk

# Update config
sudo nano /etc/fdcsds/fdcsds.config.json
# Change "drive0" to "/var/lib/fdcsds/disks/my-disk.dsk"

# Restart
sudo systemctl restart fdcsds
```

---

## Advanced Topics

### Running Multiple Instances

You can run multiple instances by:

1. **Create separate configuration files:**
```bash
sudo cp /etc/fdcsds/fdcsds.config.json /etc/fdcsds/fdcsds-2.config.json
```

2. **Create a new systemd service:**
```bash
sudo cp /lib/systemd/system/fdcsds.service /etc/systemd/system/fdcsds-2.service
sudo nano /etc/systemd/system/fdcsds-2.service
# Change --config path and webPort
```

3. **Start the second instance:**
```bash
sudo systemctl daemon-reload
sudo systemctl start fdcsds-2
```

### Development and Testing

**Install from source (without package):**
```bash
npm install
npm run build
sudo npm link
fdcsds --help
```

**Run without systemd:**
```bash
/usr/bin/fdcsds --config /etc/fdcsds/fdcsds.config.json
```

### Package Validation

**Check package contents:**
```bash
dpkg -L fdcsds
```

**Check package info:**
```bash
dpkg -s fdcsds
```

**Verify files:**
```bash
debsums fdcsds
```

---

## Additional Resources

- **Main Documentation:** `/usr/share/doc/fdcsds/README.md`
- **Web Interface Guide:** `/usr/share/doc/fdcsds/WEB-INTERFACE.md`
- **Quick Start:** `/usr/share/doc/fdcsds/QUICKSTART.md`
- **Troubleshooting:** `/usr/share/doc/fdcsds/TROUBLESHOOTING.md`

---

## Support

For issues and questions:

1. Check the logs: `sudo journalctl -u fdcsds -n 100`
2. Review documentation in `/usr/share/doc/fdcsds/`
3. Visit the project repository for updates

---

## Building for Distribution

### Creating a Repository Package

For deploying to multiple Raspberry Pis:

1. **Build the package:**
```bash
make deb
```

2. **Copy to a shared location:**
```bash
scp ../fdcsds_2.0.0-1_all.deb pi@other-pi:/tmp/
```

3. **Install on other systems:**
```bash
ssh pi@other-pi
sudo dpkg -i /tmp/fdcsds_2.0.0-1_all.deb
sudo apt-get install -f
```

### Hosting a Local Repository

Set up a local APT repository for easy distribution:

```bash
# On the build server
mkdir -p ~/apt-repo
cp ../fdcsds_2.0.0-1_all.deb ~/apt-repo/
cd ~/apt-repo
dpkg-scanpackages . /dev/null | gzip -9c > Packages.gz

# On Raspberry Pis
echo "deb [trusted=yes] http://build-server/apt-repo ./" | \
  sudo tee /etc/apt/sources.list.d/fdcsds.list
sudo apt-get update
sudo apt-get install fdcsds
```

---

**Version:** 2.0.0
**Last Updated:** 2025-11-17
