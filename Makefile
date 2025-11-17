# Makefile for FDC+ Serial Drive Server
# This provides convenience targets for Debian package building

.PHONY: all build clean install deb deb-clean deb-source help

# Package information
PACKAGE_NAME := fdcsds
VERSION := 2.0.0
ARCH := all

all: build

# Build the TypeScript project
build:
	@echo "Building TypeScript project..."
	npm install
	npm run build

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	rm -rf dist
	rm -rf node_modules
	npm run clean || true

# Install the application (for local testing)
install: build
	@echo "Installing fdcsds locally..."
	npm install -g .

# Build Debian package
deb: build
	@echo "Building Debian package..."
	dpkg-buildpackage -us -uc -b

# Build source package (for uploading to repositories)
deb-source:
	@echo "Building Debian source package..."
	dpkg-buildpackage -us -uc -S

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

# Full clean (including parent directory .deb files)
distclean: clean deb-clean
	@echo "Removing all generated files..."
	rm -f ../*.deb
	rm -f ../*.changes
	rm -f ../*.buildinfo
	rm -f ../*.dsc
	rm -f ../*.tar.*

# Install build dependencies
install-build-deps:
	@echo "Installing build dependencies..."
	sudo apt-get update
	sudo apt-get install -y build-essential debhelper devscripts nodejs npm

# Quick build and install (for testing)
quick-install: deb
	@echo "Installing package..."
	sudo dpkg -i ../$(PACKAGE_NAME)_$(VERSION)-1_$(ARCH).deb || sudo apt-get install -f -y

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
	@echo "  ../$(PACKAGE_NAME)_$(VERSION)-1_$(ARCH).deb"

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
	@echo "  4. sudo dpkg -i ../fdcsds_2.0.0-1_all.deb"
