const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const outputPath = path.join(__dirname, '../src/build-info.json');

// Sanitize function to prevent injection
function sanitize(str) {
    if (typeof str !== 'string') return 'unknown';
    // Remove any non-alphanumeric, dash, underscore, dot, colon, space, plus chars
    return str.replace(/[^\w\-.:+\/\s]/g, '').trim();
}

try {
    // Execute git commands with limited scope
    const commit = sanitize(execSync('git rev-parse --short HEAD', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: false
    }).trim());

    const branch = sanitize(execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: false
    }).trim());

    const commitDate = sanitize(execSync('git log -1 --format=%ci', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: false
    }).trim());

    const buildDate = new Date().toISOString();

    const buildInfo = {
        commit: commit || 'unknown',
        branch: branch || 'unknown',
        commitDate: commitDate || null,
        buildDate: buildDate
    };

    fs.writeFileSync(outputPath, JSON.stringify(buildInfo, null, 2));
    console.log('[BUILD] Build info written to ' + outputPath);
    console.log('[BUILD] Commit: ' + commit + ' | Branch: ' + branch);
} catch (err) {
    console.warn('[BUILD] Git not available, writing minimal build info');
    const buildInfo = {
        commit: 'unknown',
        branch: 'unknown',
        commitDate: null,
        buildDate: new Date().toISOString()
    };
    fs.writeFileSync(outputPath, JSON.stringify(buildInfo, null, 2));
}
