const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MINIMUM_LOCKFILE_VERSION = 2;
const NPM_REGISTRY = 'https://registry.npmjs.org/';

function readJson(name) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
}

test('a package-lock.json is committed and pins every dependency', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'package-lock.json')), 'package-lock.json is missing, so npm ci cannot run');
    const manifest = readJson('package.json');
    const lock = readJson('package-lock.json');
    assert.ok(lock.lockfileVersion >= MINIMUM_LOCKFILE_VERSION);
    assert.equal(lock.name, manifest.name);
    assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
    for (const name of Object.keys(manifest.dependencies)) {
        const locked = lock.packages[`node_modules/${name}`];
        assert.ok(locked, `${name} is not in package-lock.json`);
        assert.match(locked.version, /^\d+\.\d+\.\d+/);
        assert.ok(locked.resolved.startsWith(NPM_REGISTRY), `${name} resolves outside the npm registry`);
        assert.match(locked.integrity, /^sha512-/);
    }
});
