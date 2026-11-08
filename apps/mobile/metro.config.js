// Expo SDK 52+ detects npm workspaces automatically (watchFolders, nodeModulesPaths).
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
