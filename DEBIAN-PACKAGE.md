# Debian Package Installation Guide

This guide explains how to build and install the BitsBy8 Serial Drive Server as a Debian package on Raspbian/Raspberry Pi OS.

> **Command name:** the installed CLI is `bitsby8`. A `fdcsds` alias is also
> installed and still works, so older instructions and scripts keep running —
> but `bitsby8` is the canonical command going forward.

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

- **Package Name:** `bitsby8`
- **Version:** 3.0.0-alpha
- **Architecture:** all (platform-independent)
- **Dependencies:** nodejs (>= 18.0.0)

> Renamed from `fdcsds`: the package now declares `Conflicts`/`Replaces`/`Provides:
> fdcsds`, so installing `bitsby8` cleanly supersedes an older `fdcsds` install.
> See [Upgrading](#upgrading) for how existing data is migrated.

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
ls -lh ../bitsby8_*.deb
```

You should see something like:
```
../bitsby8_3.0.0~alpha-1_all.deb
```

---

## Installing the Package

### Standard Installation

Install the package using `dpkg`:

```bash
sudo dpkg -i ../bitsby8_*_all.deb
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
========================================================================
  BitsBy8 Serial Drive Server (bitsby8) has been installed successfully!
========================================================================

Next steps:

1. Edit the configuration file:
   sudo nano /etc/bitsby8/bitsby8.config.json

2. Configure your serial ports and disk images

3. Start the service:
   sudo systemctl start bitsby8

4. Enable automatic startup on boot:
   sudo systemctl enable bitsby8

5. Check service status:
   sudo systemctl status bitsby8

6. View logs:
   sudo journalctl -u bitsby8 -f

7. Access the web interface (if enabled):
   http://raspberrypi.local:3000

Documentation: /usr/share/doc/bitsby8/
Sample disk images: /usr/share/bitsby8/disks/
========================================================================
```

---

## Configuration

### Default Configuration File

The main configuration file is located at:

```
/etc/bitsby8/bitsby8.config.json
```

### Default Settings (Raspbian-optimized)

```json
{
  "port": "/dev/ttyUSB0",
  "baud": 230400,
  "drive0": "/usr/share/bitsby8/disks/cpm22.dsk",
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
sudo nano /etc/bitsby8/bitsby8.config.json
```

**Important:** After editing, restart the service:

```bash
sudo systemctl restart bitsby8
```

### Configuration Preservation

The configuration file is marked as a **conffile**, meaning:
- Your changes are preserved during package upgrades
- If the packaged version changes, you'll be prompted to keep or replace your version

### Example Configuration Template

An example configuration is available at:

```
/etc/bitsby8/bitsby8.config.example
```

---

## Service Management

The package includes a systemd service for automatic management.

### Service Commands

**Start the service:**
```bash
sudo systemctl start bitsby8
```

**Stop the service:**
```bash
sudo systemctl stop bitsby8
```

**Restart the service:**
```bash
sudo systemctl restart bitsby8
```

**Check status:**
```bash
sudo systemctl status bitsby8
```

**Enable automatic startup:**
```bash
sudo systemctl enable bitsby8
```

**Disable automatic startup:**
```bash
sudo systemctl disable bitsby8
```

### Viewing Logs

**Real-time logs:**
```bash
sudo journalctl -u bitsby8 -f
```

**Recent logs:**
```bash
sudo journalctl -u bitsby8 -n 50
```

**Logs since last boot:**
```bash
sudo journalctl -u bitsby8 -b
```

### Service User

The service runs as the `bitsby8` system user with:
- Membership in the `dialout` group (for serial port access)
- Home directory: `/var/lib/bitsby8`
- No login shell (security)

---

## File Locations

### Application Files

| Path | Description |
|------|-------------|
| `/usr/bin/bitsby8` | Main executable (symlink) |
| `/usr/bin/fdcsds` | Backward-compatibility alias (same target) |
| `/usr/lib/bitsby8/` | Application installation directory |
| `/usr/lib/bitsby8/dist/` | Compiled JavaScript |
| `/usr/lib/bitsby8/frontend/dist/` | Web interface files (Svelte build) |
| `/usr/lib/bitsby8/node_modules/` | Node.js dependencies |

### Configuration Files

| Path | Description |
|------|-------------|
| `/etc/bitsby8/bitsby8.config.json` | Main configuration file (conffile) |
| `/etc/bitsby8/bitsby8.config.example` | Example configuration |
| `/etc/default/bitsby8` | Environment variables (conffile) |

### Runtime Files

| Path | Description |
|------|-------------|
| `/var/lib/bitsby8/` | Working directory (owned by bitsby8 user) |
| `/var/log/bitsby8/` | Log directory (owned by bitsby8 user) |

### Documentation

| Path | Description |
|------|-------------|
| `/usr/share/doc/bitsby8/` | Documentation directory |
| `/usr/share/doc/bitsby8/README.md` | Main documentation (includes Quickstart section) |
| `/usr/share/doc/bitsby8/WEB-INTERFACE.md` | Web interface guide |

### Sample Files

| Path | Description |
|------|-------------|
| `/usr/share/bitsby8/disks/` | Sample disk images |

### System Integration

| Path | Description |
|------|-------------|
| `/lib/systemd/system/bitsby8.service` | systemd service unit |

---

## Upgrading

### From a previous `bitsby8` release

When a new version is released:

1. **Build the new package:**

```bash
cd /path/to/fdcplus-web
git pull
make deb
```

2. **Install the upgrade:**

```bash
sudo dpkg -i ../bitsby8_*_all.deb
```

3. **Review configuration changes (if prompted):**

The installer will ask if you want to keep your existing configuration or use the new default. Choose based on your needs.

4. **Restart the service:**

```bash
sudo systemctl restart bitsby8
```

### From an older `fdcsds` install (automatic migration)

Installing `bitsby8` over a legacy `fdcsds` package is a supported upgrade — apt
supersedes `fdcsds` via `Conflicts`/`Replaces`, and the maintainer scripts carry
your data across:

- **Config** at `/etc/fdcsds/fdcsds.config.json` (and `/etc/default/fdcsds`) is
  seeded into `/etc/bitsby8/…` before the new conffile is unpacked, so your edits
  survive.
- **Data and logs** at `/var/lib/fdcsds` and `/var/log/fdcsds` are moved to
  `/var/lib/bitsby8` and `/var/log/bitsby8`, with backward-compatibility symlinks
  left at the old paths.
- **Database and runtime override** (`fdcplus.db`, `fdcsds.overrides.json`) are
  renamed to `bitsby8.db` / `bitsby8.overrides.json` in place the first time the
  daemon starts.

```bash
# on a box that currently has fdcsds installed
sudo apt-get install ./bitsby8_*_all.deb    # or: sudo dpkg -i … ; sudo apt-get install -f
sudo systemctl enable --now bitsby8
```

Nothing else is required — the old `fdcsds` service is stopped and removed as part
of the upgrade, and the `/usr/bin/fdcsds` alias keeps any of your own scripts
working.

### Configuration Handling During Upgrade

- Your `/etc/bitsby8/bitsby8.config.json` is preserved
- If the packaged version changes, dpkg will prompt you with options
- Your disk images in `/var/lib/bitsby8/` are never touched

---

## Removing

### Remove Package (Keep Configuration)

```bash
sudo apt-get remove bitsby8
```

This removes the application but keeps:
- Configuration files in `/etc/bitsby8/`
- User data in `/var/lib/bitsby8/`
- The `bitsby8` system user

### Purge (Complete Removal)

```bash
sudo apt-get purge bitsby8
```

This completely removes:
- All application files
- All configuration files
- All user data and logs
- The `bitsby8` system user and group

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
sudo usermod -a -G dialout bitsby8
sudo systemctl restart bitsby8
```

**Check configuration syntax:**
```bash
# Test JSON syntax
python3 -m json.tool /etc/bitsby8/bitsby8.config.json
```

**Check logs:**
```bash
sudo journalctl -u bitsby8 -n 50
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
sudo nano /etc/bitsby8/bitsby8.config.json
# Change "port" to your actual device
sudo systemctl restart bitsby8
```

### Web Interface Not Accessible

**Check if web interface is enabled:**
```bash
grep '"web"' /etc/bitsby8/bitsby8.config.json
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

The `bitsby8` user needs access to serial ports:

```bash
# Verify dialout group membership
groups bitsby8

# Should show: bitsby8 : bitsby8 dialout

# If not, add manually:
sudo usermod -a -G dialout bitsby8
sudo systemctl restart bitsby8
```

### Disk Image Issues

**Verify disk image paths:**
```bash
ls -l /usr/share/bitsby8/disks/
```

**Use custom disk images:**
```bash
# Copy your images
sudo mkdir -p /var/lib/bitsby8/disks
sudo cp my-disk.dsk /var/lib/bitsby8/disks/
sudo chown bitsby8:bitsby8 /var/lib/bitsby8/disks/my-disk.dsk

# Update config
sudo nano /etc/bitsby8/bitsby8.config.json
# Change "drive0" to "/var/lib/bitsby8/disks/my-disk.dsk"

# Restart
sudo systemctl restart bitsby8
```

---

## Advanced Topics

### Running Multiple Instances

You can run multiple instances by:

1. **Create separate configuration files:**
```bash
sudo cp /etc/bitsby8/bitsby8.config.json /etc/bitsby8/bitsby8-2.config.json
```

2. **Create a new systemd service:**
```bash
sudo cp /lib/systemd/system/bitsby8.service /etc/systemd/system/bitsby8-2.service
sudo nano /etc/systemd/system/bitsby8-2.service
# Change --config path and webPort
```

3. **Start the second instance:**
```bash
sudo systemctl daemon-reload
sudo systemctl start bitsby8-2
```

### Development and Testing

**Install from source (without package):**
```bash
npm install
npm run build
sudo npm link
bitsby8 --help      # the `fdcsds` alias also works
```

**Run without systemd:**
```bash
/usr/bin/bitsby8 --config /etc/bitsby8/bitsby8.config.json
```

### Package Validation

**Check package contents:**
```bash
dpkg -L bitsby8
```

**Check package info:**
```bash
dpkg -s bitsby8
```

**Verify files:**
```bash
debsums bitsby8
```

---

## Additional Resources

- **Main Documentation:** `/usr/share/doc/bitsby8/README.md` (includes `## Quickstart`)
- **Web Interface Guide:** `/usr/share/doc/bitsby8/WEB-INTERFACE.md`
- **Troubleshooting:** `/usr/share/doc/bitsby8/TROUBLESHOOTING.md`

---

## Support

For issues and questions:

1. Check the logs: `sudo journalctl -u bitsby8 -n 100`
2. Review documentation in `/usr/share/doc/bitsby8/`
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
scp ../bitsby8_*_all.deb pi@other-pi:/tmp/
```

3. **Install on other systems:**
```bash
ssh pi@other-pi
sudo dpkg -i /tmp/bitsby8_*_all.deb
sudo apt-get install -f
```

### Hosting a Local Repository

Set up a local APT repository for easy distribution:

```bash
# On the build server
mkdir -p ~/apt-repo
cp ../bitsby8_*_all.deb ~/apt-repo/
cd ~/apt-repo
dpkg-scanpackages . /dev/null | gzip -9c > Packages.gz

# On Raspberry Pis
echo "deb [trusted=yes] http://build-server/apt-repo ./" | \
  sudo tee /etc/apt/sources.list.d/bitsby8.list
sudo apt-get update
sudo apt-get install bitsby8
```

---

**Version:** 3.0.0-alpha
**Last Updated:** 2026-07-20
