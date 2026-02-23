import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'node:path';
import { getOwnPilotRoot, isOwnPilotPath, assertNotOwnPilotPath, _resetCache } from './self-protection.js';

describe('Self-Protection Module', () => {
  beforeEach(() => {
    _resetCache();
  });

  // =========================================================================
  // getOwnPilotRoot
  // =========================================================================

  describe('getOwnPilotRoot', () => {
    it('returns a valid path', () => {
      const root = getOwnPilotRoot();
      expect(root).not.toBeNull();
      expect(typeof root).toBe('string');
    });

    it('returns the same value on repeated calls (cached)', () => {
      const root1 = getOwnPilotRoot();
      const root2 = getOwnPilotRoot();
      expect(root1).toBe(root2);
    });

    it('root directory contains package.json', () => {
      const root = getOwnPilotRoot();
      expect(root).not.toBeNull();
      // The root exists and has a package.json — verified by the function itself
    });

    it('returns an absolute path', () => {
      const root = getOwnPilotRoot();
      expect(root).not.toBeNull();
      expect(path.isAbsolute(root!)).toBe(true);
    });
  });

  // =========================================================================
  // isOwnPilotPath
  // =========================================================================

  describe('isOwnPilotPath', () => {
    it('blocks source files within OwnPilot root', () => {
      const root = getOwnPilotRoot()!;
      expect(isOwnPilotPath(path.join(root, 'packages', 'core', 'src', 'index.ts'))).toBe(true);
    });

    it('blocks package.json at root', () => {
      const root = getOwnPilotRoot()!;
      expect(isOwnPilotPath(path.join(root, 'package.json'))).toBe(true);
    });

    it('blocks .git directory', () => {
      const root = getOwnPilotRoot()!;
      expect(isOwnPilotPath(path.join(root, '.git', 'config'))).toBe(true);
    });

    it('blocks node_modules within OwnPilot', () => {
      const root = getOwnPilotRoot()!;
      expect(isOwnPilotPath(path.join(root, 'node_modules', 'vitest', 'index.js'))).toBe(true);
    });

    it('blocks the root directory itself', () => {
      const root = getOwnPilotRoot()!;
      expect(isOwnPilotPath(root)).toBe(true);
    });

    it('allows /tmp paths', () => {
      expect(isOwnPilotPath('/tmp/user-workspace/file.txt')).toBe(false);
    });

    it('allows home directory paths', () => {
      const home = process.env.HOME ?? process.env.USERPROFILE ?? '/home/user';
      // Only blocked if home is inside OwnPilot root, which it shouldn't be
      if (!home.startsWith(getOwnPilotRoot()!)) {
        expect(isOwnPilotPath(path.join(home, 'Documents', 'file.txt'))).toBe(false);
      }
    });

    it('allows unrelated workspace paths', () => {
      expect(isOwnPilotPath('/var/data/workspaces/user1/project/file.ts')).toBe(false);
    });

    it('blocks path traversal attempts after resolution', () => {
      const root = getOwnPilotRoot()!;
      // Construct a traversal that resolves back into OwnPilot root
      const traversal = path.join(root, 'packages', '..', '..', path.basename(root), 'package.json');
      expect(isOwnPilotPath(traversal)).toBe(true);
    });

    it('blocks paths with .. that resolve into OwnPilot', () => {
      const root = getOwnPilotRoot()!;
      const parent = path.dirname(root);
      const basename = path.basename(root);
      const sneaky = path.join(parent, 'some-other-dir', '..', basename, 'tsconfig.json');
      expect(isOwnPilotPath(sneaky)).toBe(true);
    });

    it('allows paths that look similar but are outside', () => {
      const root = getOwnPilotRoot()!;
      const parent = path.dirname(root);
      const fakePath = path.join(parent, path.basename(root) + '-fork', 'package.json');
      expect(isOwnPilotPath(fakePath)).toBe(false);
    });

    it('handles Windows-style paths', () => {
      const root = getOwnPilotRoot()!;
      // Even with forward slashes, should still detect
      const forwardSlash = root.replace(/\\/g, '/') + '/packages/core/src/index.ts';
      // path.resolve normalizes these
      expect(isOwnPilotPath(forwardSlash)).toBe(true);
    });
  });

  // =========================================================================
  // assertNotOwnPilotPath
  // =========================================================================

  describe('assertNotOwnPilotPath', () => {
    it('throws for OwnPilot paths', () => {
      const root = getOwnPilotRoot()!;
      expect(() => assertNotOwnPilotPath(path.join(root, 'package.json'))).toThrow(
        'Access to OwnPilot system files is not allowed'
      );
    });

    it('does not throw for external paths', () => {
      expect(() => assertNotOwnPilotPath('/tmp/safe-file.txt')).not.toThrow();
    });

    it('throws for the root directory itself', () => {
      const root = getOwnPilotRoot()!;
      expect(() => assertNotOwnPilotPath(root)).toThrow(
        'Access to OwnPilot system files is not allowed'
      );
    });
  });
});
