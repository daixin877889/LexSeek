
import fs from 'node:fs';
import path from 'node:path';

// --- Types ---

interface ApifoxProject {
  apiCollection: ApifoxItem[];
  [key: string]: any;
}

interface ApifoxItem {
  id: number | string;
  name: string;
  parentId?: number | string;
  items?: ApifoxItem[]; // For folders
  api?: ApifoxApi;      // For APIs
  type?: string;        // "folder" or "http" (optional but good for import)
  [key: string]: any;
}

interface ApifoxApi {
  id: number | string;
  method: string;
  path: string;
  name: string;
  description?: string;
  type?: string;        // "http"
  status?: string;      // "released", "developing"
  [key: string]: any;
}

interface ApiFileInfo {
  filePath: string;
  method: string;
  urlPath: string;
  name?: string;
  description?: string;
  folderPath: string[]; // e.g., ['v1', 'auth']
}

// --- Configuration ---

const APIFOX_JSON_PATH = path.resolve(process.cwd(), 'docs/api/lsNew.apifox.json');
const SERVER_API_ROOT = path.resolve(process.cwd(), 'server/api'); // We will strip v1 logic inside parseApiFile

// --- Helpers ---

function generateId(): number {
  // Return a safe integer ID (timestamp + random)
  return parseInt(String(Date.now()).slice(3) + String(Math.floor(Math.random() * 10000)));
}

function scanFiles(dir: string, fileList: string[] = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      scanFiles(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  });
  return fileList;
}

function parseApiFile(fullPath: string, rootDir: string): ApiFileInfo | null {
  const relativePath = path.relative(rootDir, fullPath);
  const parsedPath = path.parse(relativePath);

  const match = parsedPath.name.match(/^(.+)\.(get|post|put|delete|patch|head|options)$/i);
  if (!match) {
    return null;
  }

  let routeName = match[1];
  const method = match[2].toLowerCase();

  const dirSegments = parsedPath.dir.split(path.sep).filter(s => s);

  // STRIP 'v1' IF PRESENT to flatten hierarchy
  if (dirSegments.length > 0 && dirSegments[0] === 'v1') {
      dirSegments.shift();
  }

  const originalDirSegments = parsedPath.dir.split(path.sep).filter(s => s);
  // Reconstruct URL path using ORIGINAL segments (so path is still /api/v1/...)
  let urlSegments = [...originalDirSegments];
  if (routeName !== 'index') {
    urlSegments.push(routeName);
  }

  let urlPath = '/api/' + urlSegments.join('/');
  urlPath = urlPath.replace(/\[([^\]]+)\]/g, '{$1}');

  // Folder path for Docs uses the stripped version
  const folderPath = [...dirSegments]; // This is already stripped above

  const content = fs.readFileSync(fullPath, 'utf-8');
  let name = '';
  let description = '';

  const jsDocRegex = /\/\*\*([\s\S]*?)\*\/\s*export\s+default\s+(?:defineEventHandler|eventHandler)/;
  const jsDocMatch = content.match(jsDocRegex);

  if (jsDocMatch) {
    const docContent = jsDocMatch[1];
    const lines = docContent.split('\n')
      .map(line => line.trim().replace(/^\*\s?/, '').trim())
      .filter(line => line.length > 0);

    if (lines.length > 0) {
      name = lines[0];
      if (lines.length > 1) {
        description = lines.slice(1).join('\n');
      }
    }
  }

  if (!name) {
    name = routeName === 'index'
      ? (folderPath[folderPath.length - 1] || 'root')
      : routeName;
  }

  return {
    filePath: fullPath,
    method,
    urlPath,
    name,
    description,
    folderPath
  };
}

// Helper to find/create folders and return the final parent ID and the items array
function findOrCreateFolder(rootItems: ApifoxItem[], folderNames: string[]): { items: ApifoxItem[], parentId: number | string } {
  let currentItems = rootItems;
  let currentParentId: number | string = 0; // Default root parentId

  for (const folderName of folderNames) {
    // Find folder in current level
    let folder = currentItems.find(item => (item.items || item.type === 'folder') && item.name === folderName);

    if (!folder) {
      // Create new folder
      const newFolderId = generateId();
      folder = {
        id: newFolderId,
        name: folderName,
        parentId: currentParentId,
        items: [],
        type: "folder"
      };
      currentItems.push(folder);
    }

    if (!folder.items) {
      folder.items = [];
    }

    currentItems = folder.items;
    currentParentId = folder.id;
  }

  return { items: currentItems, parentId: currentParentId };
}


function extractExistingApis(items: ApifoxItem[], map: Map<string, ApifoxItem>) {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.items) {
      extractExistingApis(item.items, map);
    } else if (item.api) {
      const key = `${item.api.method.toLowerCase()}:${item.api.path}`;
      map.set(key, item);
      items.splice(i, 1);
    }
  }
}

// --- Main ---

async function main() {
  if (!fs.existsSync(APIFOX_JSON_PATH)) {
    console.error(`File not found: ${APIFOX_JSON_PATH}`);
    process.exit(1);
  }

  const projectData: ApifoxProject = JSON.parse(fs.readFileSync(APIFOX_JSON_PATH, 'utf-8'));

  console.log('Scanning API files...');
  const files = scanFiles(SERVER_API_ROOT);
  const apiFiles: ApiFileInfo[] = [];

  for (const file of files) {
    const apiInfo = parseApiFile(file, SERVER_API_ROOT);
    if (apiInfo) {
      apiFiles.push(apiInfo);
    }
  }

  console.log(`Found ${apiFiles.length} API files.`);

  const existingApis = new Map<string, ApifoxItem>();
  extractExistingApis(projectData.apiCollection, existingApis);

  for (const info of apiFiles) {
    const { items: targetFolderItems, parentId } = findOrCreateFolder(projectData.apiCollection, info.folderPath);
    const key = `${info.method}:${info.urlPath}`;

    let item = existingApis.get(key);

    if (item && item.api) {
      console.log(`Updating ${info.method.toUpperCase()} ${info.urlPath}`);
      if (info.name) item.name = info.name;
      if (info.name) item.api.name = info.name;
      if (info.description) item.api.description = info.description;
      item.api.method = info.method;
      item.api.path = info.urlPath;
      if (!item.api.type) item.api.type = 'http';
      if (!item.api.status) item.api.status = 'developing';

      // Update parentId!
      item.parentId = parentId;

    } else {
      console.log(`Adding ${info.method.toUpperCase()} ${info.urlPath}`);
      item = {
        name: info.name || info.urlPath,
        parentId: parentId,
        id: generateId(),
        api: {
          id: generateId(),
          method: info.method,
          path: info.urlPath,
          name: info.name || info.urlPath,
          description: info.description || '',
          type: 'http',
          status: 'developing',
          parameters: {
            path: [],
            query: [],
            cookie: [],
            header: []
          },
          auth: {},
          commonParameters: {},
          responses: [],
          responseExamples: [],
          requestBody: {
            type: "application/json",
            parameters: [],
            jsonSchema: {
              type: "object",
              properties: {}
            }
          }
        }
      };
    }

    targetFolderItems.push(item);
  }

  function cleanupEmptyFolders(items: ApifoxItem[]): boolean {
     for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.items) {
           const isEmpty = cleanupEmptyFolders(item.items);
           if (isEmpty && item.items.length === 0) {
              console.log(`Removing empty folder: ${item.name}`);
              items.splice(i, 1);
           }
        }
     }
     return true;
  }

  cleanupEmptyFolders(projectData.apiCollection);

  fs.writeFileSync(APIFOX_JSON_PATH, JSON.stringify(projectData, null, 2));
  console.log('Done.');
}

main().catch(console.error);
