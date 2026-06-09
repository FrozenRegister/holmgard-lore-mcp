import fs from 'fs';
import path from 'path';
import glob from 'glob';

// Get all test files
const files = glob.sync('src/__tests__/**/*.test.ts');

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');

  // Find import lines
  let helpers Imports = [];
  let cloudflareImports = [];
  let vitestImports = [];
  let importLines = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("from './helpers'")) {
      helpersImports = lines[i].match(/{([^}]+)}/)[1].split(',').map(x => x.trim());
      importLines.push(i);
    } else if (lines[i].includes("from 'cloudflare:test'")) {
      cloudflareImports = lines[i].match(/{([^}]+)}/)[1].split(',').map(x => x.trim());
      importLines.push(i);
    } else if (lines[i].includes("from 'vitest'")) {
      vitestImports = lines[i].match(/{([^}]+)}/)[1].split(',').map(x => x.trim());
      importLines.push(i);
    }
  }

  // Check which imports are used
  const fileContent = content;
  const usedHelpers = helpersImports.filter(imp => {
    const regex = new RegExp(`\\b${imp}\\b`);
    // Skip the import line itself
    const contentWithoutImports = lines.filter((_, i) => !importLines.includes(i)).join('\n');
    return regex.test(contentWithoutImports);
  });

  const usedCloudflare = cloudflareImports.filter(imp => {
    const regex = new RegExp(`\\b${imp}\\b`);
    const contentWithoutImports = lines.filter((_, i) => !importLines.includes(i)).join('\n');
    return regex.test(contentWithoutImports);
  });

  const usedVitest = vitestImports.filter(imp => {
    const regex = new RegExp(`\\b${imp}\\b`);
    const contentWithoutImports = lines.filter((_, i) => !importLines.includes(i)).join('\n');
    return regex.test(contentWithoutImports);
  });

  // Rebuild imports
  let newLines = lines.slice();

  // Update helpers import
  if (helpersImports.length > 0) {
    const helpersLine = newLines.findIndex(l => l.includes("from './helpers'"));
    if (helpersLine >= 0) {
      if (usedHelpers.length > 0) {
        newLines[helpersLine] = `import { ${usedHelpers.join(', ')} } from './helpers'`;
      } else {
        newLines[helpersLine] = '';
      }
    }
  }

  // Update cloudflare import
  if (cloudflareImports.length > 0) {
    const cfLine = newLines.findIndex(l => l.includes("from 'cloudflare:test'"));
    if (cfLine >= 0) {
      if (usedCloudflare.length > 0) {
        newLines[cfLine] = `import { ${usedCloudflare.join(', ')} } from 'cloudflare:test'`;
      } else {
        newLines[cfLine] = '';
      }
    }
  }

  // Update vitest import
  if (vitestImports.length > 0) {
    const vLine = newLines.findIndex(l => l.includes("from 'vitest'"));
    if (vLine >= 0) {
      if (usedVitest.length > 0) {
        newLines[vLine] = `import { ${usedVitest.join(', ')} } from 'vitest'`;
      } else {
        newLines[vLine] = '';
      }
    }
  }

  // Remove empty lines at the top
  while (newLines[0] === '') {
    newLines.shift();
  }

  fs.writeFileSync(file, newLines.join('\n'), 'utf8');
  console.log(`Fixed: ${file}`);
}
