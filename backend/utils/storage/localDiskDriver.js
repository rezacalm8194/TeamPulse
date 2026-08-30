const fs = require('fs');
const path = require('path');

function assertSafeKey(key) {
  const parts = String(key || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '.' || part === '..')) {
    const error = new Error('invalid_storage_key');
    error.code = 'invalid_storage_key';
    throw error;
  }
  return parts;
}

function resolveKey(root, key) {
  const parts = assertSafeKey(key);
  const full = path.resolve(root, ...parts);
  const relative = path.relative(root, full);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error('invalid_storage_key');
    error.code = 'invalid_storage_key';
    throw error;
  }
  return full;
}

function createLocalDiskDriver(rootDir) {
  const root = path.resolve(rootDir);
  fs.mkdirSync(root, { recursive: true });

  return {
    kind: 'local',
    root,
    async put(key, buffer) {
      const target = resolveKey(root, key);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, buffer);
      const stat = await fs.promises.stat(target);
      return { key, bytes: stat.size };
    },
    putSync(key, buffer) {
      const target = resolveKey(root, key);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, buffer);
      return { key, bytes: fs.statSync(target).size };
    },
    moveFromPathSync(key, srcPath) {
      const target = resolveKey(root, key);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(srcPath, target);
      fs.unlinkSync(srcPath);
      return { key, bytes: fs.statSync(target).size };
    },
    async read(key) {
      return fs.promises.readFile(resolveKey(root, key));
    },
    readSync(key) {
      return fs.readFileSync(resolveKey(root, key));
    },
    async stat(key) {
      try {
        const info = await fs.promises.stat(resolveKey(root, key));
        return { key, bytes: info.size, mtimeMs: info.mtimeMs };
      } catch (error) {
        if (error && error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async delete(key) {
      try {
        await fs.promises.unlink(resolveKey(root, key));
        return true;
      } catch (error) {
        if (error && error.code === 'ENOENT') return false;
        throw error;
      }
    },
    deleteSync(key) {
      try {
        fs.unlinkSync(resolveKey(root, key));
        return true;
      } catch (error) {
        if (error && error.code === 'ENOENT') return false;
        throw error;
      }
    },
  };
}

module.exports = { createLocalDiskDriver, resolveKey };
