#!/bin/bash

# Clean build artifacts and dependencies

set -e

echo "🧹 Cleaning build artifacts..."

# Remove build output
if [ -d "bin" ]; then
    rm -rf bin
    echo "✅ Removed bin directory"
fi

if [ -d "dist" ]; then
    rm -rf dist
    echo "✅ Removed dist directory"
fi

# Remove coverage reports
if [ -d "coverage" ]; then
    rm -rf coverage
    echo "✅ Removed coverage directory"
fi

if [ -d ".tsbuild" ]; then
    rm -rf .tsbuild
    echo "✅ Removed .tsbuild directory"
fi

# Remove node_modules if requested. bun.lock is deliberately left alone: it is committed, and a
# clean that deletes it turns the next `bun install --frozen-lockfile` into a failure.
if [ "$1" = "--all" ] || [ "$1" = "-a" ]; then
    if [ -d "node_modules" ]; then
        rm -rf node_modules
        echo "✅ Removed node_modules directory"
    fi
fi

echo "🎉 Cleanup complete!"

if [ "$1" = "--all" ] || [ "$1" = "-a" ]; then
    echo "💡 Run 'bun install' to reinstall dependencies"
fi
