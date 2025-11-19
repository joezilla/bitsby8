#!/usr/bin/env bash

#
# FDC+ Serial Drive Server Launcher Script
# Convenience wrapper for running the TypeScript implementation
#
# Usage:
#   ./run-server.sh [options]
#   ./run-server.sh --dev [options]        # Run in development mode
#   ./run-server.sh --rebuild [options]    # Force rebuild
#   ./run-server.sh -c <config> [options]  # Use config file
#
# Config file support:
#   The server automatically searches for config files in:
#     - .fdcsds.config
#     - .config/fdcsds.json
#     - fdcsds.config.json
#   Or specify a custom config file with: -c <path> or --config <path>
#
# Examples:
#   ./run-server.sh -p /dev/ttyUSB0 -0 disks/cpm22.dsk -w
#   ./run-server.sh --config myserver.config
#   ./run-server.sh --dev -c test.config -p /dev/ttyUSB0
#   ./run-server.sh --headless -p /dev/ttyUSB0  # Run without text UI (for systemd)
#

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored messages
print_error() {
    echo -e "${RED}Error:${NC} $1" >&2
}

print_success() {
    echo -e "${GREEN}$1${NC}"
}

print_warning() {
    echo -e "${YELLOW}Warning:${NC} $1"
}

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_error "Node.js version 18 or higher is required. You have: $(node -v)"
    exit 1
fi

# Change to the script directory
cd "$SCRIPT_DIR" || exit 1

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    print_warning "Dependencies not installed. Running 'npm install'..."
    npm install || {
        print_error "Failed to install dependencies"
        exit 1
    }
fi

# Check if dist directory exists, if not build
if [ ! -d "dist" ]; then
    print_warning "Project not built. Running 'npm run build'..."
    npm run build || {
        print_error "Failed to build project"
        exit 1
    }
fi

# Determine which mode to run in
if [ "$1" = "--dev" ]; then
    # Development mode with ts-node
    shift  # Remove --dev from arguments
    print_success "Running in development mode (ts-node)..."
    exec npm run dev -- "$@"
elif [ "$1" = "--rebuild" ]; then
    # Force rebuild and run
    shift  # Remove --rebuild from arguments
    print_warning "Rebuilding project..."
    npm run build || {
        print_error "Failed to rebuild project"
        exit 1
    }
    print_success "Running compiled version..."
    exec node dist/index.js "$@"
else
    # Production mode - run compiled version
    exec node dist/index.js "$@"
fi
