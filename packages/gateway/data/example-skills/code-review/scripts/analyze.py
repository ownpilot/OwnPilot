#!/usr/bin/env python3
"""Simple code complexity analyzer."""
import sys
import re

def analyze_file(filepath):
    """Analyze a file for basic complexity metrics."""
    with open(filepath) as f:
        lines = f.readlines()

    total_lines = len(lines)
    code_lines = sum(1 for l in lines if l.strip() and not l.strip().startswith('#') and not l.strip().startswith('//'))
    comment_lines = sum(1 for l in lines if l.strip().startswith('#') or l.strip().startswith('//'))
    blank_lines = sum(1 for l in lines if not l.strip())

    # Count functions/methods
    func_pattern = re.compile(r'^\s*(def |function |async function |const \w+ = (?:async )?\()')
    functions = sum(1 for l in lines if func_pattern.match(l))

    # Max nesting depth
    max_indent = max((len(l) - len(l.lstrip())) for l in lines if l.strip()) if lines else 0

    print(f"File: {filepath}")
    print(f"Total lines: {total_lines}")
    print(f"Code lines: {code_lines}")
    print(f"Comment lines: {comment_lines}")
    print(f"Blank lines: {blank_lines}")
    print(f"Functions: {functions}")
    print(f"Max indentation: {max_indent} spaces")
    print(f"Comment ratio: {comment_lines/max(code_lines,1)*100:.1f}%")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: analyze.py <filepath>")
        sys.exit(1)
    analyze_file(sys.argv[1])
