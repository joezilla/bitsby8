# Makefile for FDC+ Serial Drive Server
# This provides convenience targets for Debian package building

.PHONY: all build clean install deb deb-clean deb-source help

# Package information
PACKAGE_NAME := fdcsds
ARCH := all

# Version is derived from git so every commit produces a distinct, monotonic
# Debian version — installs on the Pi are unambiguous and `dpkg -i` upgrades
# cleanly instead of silently keeping the older payload.
#
#   upstream = 2.0.0 (bump manually for real semver events)
#   revision = <commit-count>+g<short-sha>[.dirty.<epoch>]
#
# Examples:
#   2.0.0-142+g3387ddc
#   2.0.0-143+g84d40cb.dirty.1783198000   (uncommitted changes)
#
# Debian revisions may only contain [A-Za-z0-9.+~], so we use `+` and `.`
# as separators (never `-`, which delimits upstream/revision).
VERSION_BASE := 2.0.0
GIT_COUNT    := $(shell git rev-list --count HEAD 2>/dev/null || echo 0)
GIT_SHA      := $(shell git rev-parse --short=7 HEAD 2>/dev/null || echo unknown)
GIT_DIRTY    := $(shell git diff-index --quiet HEAD 2>/dev/null || echo .dirty.$$(date +%s))
VERSION      := $(VERSION_BASE)-$(GIT_COUNT)+g$(GIT_SHA)$(GIT_DIRTY)

all: build

# Build the TypeScript project (both trees: backend + Svelte SPA)
build:
	@echo "Building backend + frontend via pnpm workspace..."
	# corepack activation is best-effort: on hosts where it's already
	# active (or `pnpm` is on PATH via a global npm install) the shim
	# below just uses whatever's there. Requiring corepack to succeed
	# breaks unprivileged builds after `sudo corepack disable`.
	@command -v pnpm >/dev/null 2>&1 || corepack enable pnpm
	pnpm install --frozen-lockfile
	pnpm run build:all

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	rm -rf dist coverage frontend/dist
	rm -rf node_modules frontend/node_modules
	pnpm run clean || true

# Install the application (for local testing)
install: build
	@echo "Installing fdcsds locally..."
	npm install -g .

# Directory where collected dpkg-buildpackage output lands.
# Use an absolute path so the mv step is immune to any cwd shenanigans
# inside dpkg-buildpackage / debhelper.
BUILD_DIR := $(CURDIR)/build

# Force BUILD_DIR to be a real directory. Handles:
#   - missing path                → mkdir creates it
#   - existing directory          → mkdir -p is a no-op
#   - existing regular file/link  → remove, then mkdir
# (GNU mkdir -p errors on a non-directory, so we have to clear first.)
define ensure_build_dir
	@if [ -e "$(BUILD_DIR)" ] && [ ! -d "$(BUILD_DIR)" ]; then \
		echo "Removing non-directory at $(BUILD_DIR)"; \
		rm -f "$(BUILD_DIR)"; \
	fi
	@mkdir -p "$(BUILD_DIR)"
endef

# Build Debian package.
# dpkg-buildpackage always drops its output (.deb, .changes, .buildinfo)
# one directory up from the source tree — that's standard Debian convention
# and not configurable. We collect those files into $(BUILD_DIR) here so
# the output lives inside the repo and is easy to find.
deb: build
	@echo "Building Debian package $(PACKAGE_NAME) $(VERSION)..."
	$(ensure_build_dir)
	# Write a fresh top-of-changelog entry with the derived VERSION so
	# dpkg-buildpackage stamps the .deb with something unique per commit.
	# The base debian/changelog stays checked in and is restored via
	# `git checkout` after the build so the tree isn't left dirty. If the
	# git restore fails (e.g. running outside a checkout), we fall back
	# to a per-run backup copy.
	@set -e; \
	backup="debian/changelog.bak.$$$$"; \
	cp debian/changelog "$$backup"; \
	trap 'if [ -f "$$backup" ]; then \
	          if git checkout -- debian/changelog 2>/dev/null; then rm -f "$$backup"; \
	          else mv "$$backup" debian/changelog; \
	          fi; \
	      fi' EXIT INT TERM; \
	{ \
		echo "$(PACKAGE_NAME) ($(VERSION)) stable; urgency=medium"; \
		echo ""; \
		echo "  * Auto-build from $(GIT_SHA)$(GIT_DIRTY)"; \
		echo ""; \
		echo " -- Joe Toppe <mreppot@gmail.com>  $$(date -R)"; \
		echo ""; \
		cat "$$backup"; \
	} > debian/changelog; \
	dpkg-buildpackage -us -uc -b
	@echo ""
	@echo "Collecting build artifacts into $(BUILD_DIR)/ ..."
	$(ensure_build_dir)
	@moved=0; \
	for ext in deb changes buildinfo dsc; do \
		for f in ../$(PACKAGE_NAME)_$(VERSION)*.$$ext; do \
			if [ -f "$$f" ]; then \
				mv -v "$$f" "$(BUILD_DIR)/"; \
				moved=$$((moved + 1)); \
			fi; \
		done; \
	done; \
	if [ $$moved -eq 0 ]; then \
		echo "ERROR: dpkg-buildpackage finished but no $(PACKAGE_NAME)_$(VERSION)* artifacts found in ../"; \
		echo "       check the build output above."; \
		exit 1; \
	fi
	@echo ""
	@echo "Debian package created successfully:"
	@ls -lh "$(BUILD_DIR)"/$(PACKAGE_NAME)_$(VERSION)*.deb 2>/dev/null || true

# Build source package (for uploading to repositories)
deb-source:
	@echo "Building Debian source package..."
	$(ensure_build_dir)
	dpkg-buildpackage -us -uc -S
	@echo ""
	@echo "Collecting source-package artifacts into $(BUILD_DIR)/ ..."
	$(ensure_build_dir)
	@moved=0; \
	for pattern in "../$(PACKAGE_NAME)_$(VERSION)*.dsc" \
	               "../$(PACKAGE_NAME)_$(VERSION)*.tar.*" \
	               "../$(PACKAGE_NAME)_$(VERSION)*.changes" \
	               "../$(PACKAGE_NAME)_$(VERSION)*.buildinfo"; do \
		for f in $$pattern; do \
			if [ -f "$$f" ]; then \
				mv -v "$$f" "$(BUILD_DIR)/"; \
				moved=$$((moved + 1)); \
			fi; \
		done; \
	done; \
	if [ $$moved -eq 0 ]; then \
		echo "ERROR: dpkg-buildpackage finished but no source artifacts found in ../"; \
		exit 1; \
	fi
	@echo ""
	@echo "Source package created in $(BUILD_DIR)/"

# Clean Debian build artifacts
deb-clean:
	@echo "Cleaning Debian build artifacts..."
	rm -rf debian/fdcsds
	rm -rf debian/.debhelper
	rm -f debian/debhelper-build-stamp
	rm -f debian/files
	rm -f debian/*.log
	rm -f debian/*.substvars
	rm -f debian/*.debhelper
	rm -rf debian/tmp
	dh_clean || true

# Full clean (including build directory)
distclean: clean deb-clean
	@echo "Removing all generated files..."
	rm -rf build
	rm -f ../*.deb ../*.changes ../*.buildinfo ../*.dsc ../*.tar.* 2>/dev/null || true

# Install build dependencies
install-build-deps:
	@echo "Installing build dependencies..."
	sudo apt-get update
	sudo apt-get install -y build-essential debhelper devscripts nodejs npm \
	                        python3 g++
	@echo ""
	@echo "Note: pnpm is provisioned at build time via corepack (bundled with"
	@echo "Node 16+). The 'packageManager' field in package.json pins the version."

# Quick build and install (for testing)
quick-install: deb
	@echo "Installing package..."
	@deb=$$(ls -t build/$(PACKAGE_NAME)_*_$(ARCH).deb 2>/dev/null | head -1); \
	if [ -z "$$deb" ]; then echo "ERROR: no .deb found in build/"; exit 1; fi; \
	echo "Installing $$deb"; \
	sudo dpkg -i "$$deb" || sudo apt-get install -f -y

# Validate Debian package files
validate:
	@echo "Validating Debian package files..."
	@echo "Checking debian/control..."
	@test -f debian/control || (echo "ERROR: debian/control not found" && exit 1)
	@echo "Checking debian/rules..."
	@test -x debian/rules || (echo "ERROR: debian/rules not executable" && exit 1)
	@echo "Checking debian/changelog..."
	@test -f debian/changelog || (echo "ERROR: debian/changelog not found" && exit 1)
	@echo "Checking debian/copyright..."
	@test -f debian/copyright || (echo "ERROR: debian/copyright not found" && exit 1)
	@echo "Checking debian/compat..."
	@test -f debian/compat || (echo "ERROR: debian/compat not found" && exit 1)
	@echo "All required Debian files are present!"
	@echo ""
	@echo "Running lintian checks (if available)..."
	@which lintian >/dev/null 2>&1 && lintian debian/control || echo "lintian not installed, skipping"

# Show package information
info:
	@echo "Package Information:"
	@echo "  Name:    $(PACKAGE_NAME)"
	@echo "  Version: $(VERSION)"
	@echo "  Arch:    $(ARCH)"
	@echo ""
	@echo "Build output will be:"
	@echo "  build/$(PACKAGE_NAME)_$(VERSION)_$(ARCH).deb"

# Help target
help:
	@echo "FDC+ Serial Drive Server - Makefile targets:"
	@echo ""
	@echo "Building:"
	@echo "  make build              - Build TypeScript project"
	@echo "  make deb                - Build Debian package"
	@echo "  make deb-source         - Build Debian source package"
	@echo ""
	@echo "Cleaning:"
	@echo "  make clean              - Clean build artifacts"
	@echo "  make deb-clean          - Clean Debian build artifacts"
	@echo "  make distclean          - Full clean (including .deb files)"
	@echo ""
	@echo "Installation:"
	@echo "  make install            - Install globally via npm"
	@echo "  make quick-install      - Build and install Debian package"
	@echo "  make install-build-deps - Install build dependencies"
	@echo ""
	@echo "Testing:"
	@echo "  make validate           - Validate Debian package files"
	@echo "  make info               - Show package information"
	@echo ""
	@echo "Example workflow:"
	@echo "  1. make install-build-deps"
	@echo "  2. make validate"
	@echo "  3. make deb"
	@echo "  4. sudo dpkg -i build/$(PACKAGE_NAME)_*.deb   # or: make quick-install"
