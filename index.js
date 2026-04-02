const {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    CompletionItem,
    CompletionItemKind,
    TextDocumentSyncKind
} = require('vscode-languageserver/node');

const { TextDocument } = require('vscode-languageserver-textdocument');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

// Helper function to normalize paths from different editors
function normalizeUri(uri) {
    if (!uri) return null;
    
    let filePath = uri;
    if (uri.startsWith('file://')) {
        // file:///path -> /path (Linux/macOS)
        // file:///C:/path -> C:/path (Windows)
        filePath = decodeURIComponent(uri.replace(/^file:\/\/\/?/, ''));
        
        // On Windows, paths like C:/path might still have a leading slash from file:///C:/
        if (process.platform === 'win32' || filePath.match(/^[a-zA-Z]:/)) {
            // Already correct or handles drive letter
        } else if (uri.startsWith('file:///')) {
            // Restore leading slash for Linux/macOS
            filePath = '/' + filePath;
        }
    }
    
    // Normalize path separators
    return path.normalize(filePath);
}


// Create a connection for the server
// Supports both IPC (VS Code) and stdio (Sublime Text, Vim, etc.)
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager
const documents = new TextDocuments(TextDocument);

// CSS classes cache
let cssClasses = {};
let cssFolders = [];
let cssFiles = [];
let autoSearch = false;
let supportedLanguages = [];
let workspaceFolders = [];

connection.onInitialize((params) => {
    // Normalize workspace folder URIs
    workspaceFolders = (params.workspaceFolders || []).map(folder => ({
        uri: normalizeUri(folder.uri),
        name: folder.name
    }));
    
    connection.console.log('CSS Intellisense Language Server initialized');    

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: false,
                triggerCharacters: ['"', "'", ' ']
            }
        }
    };
});

connection.onInitialized(() => {
    connection.console.log('Language Server initialized, waiting for configuration');
});

// Handle configuration changes
connection.onDidChangeConfiguration(async (change) => {
    const settings = change.settings.cssIntellisense || {};
    
    cssFolders = settings.css_folders || [];
    cssFiles = settings.css_files || [];
    autoSearch = settings.auto_search || false;
    supportedLanguages = settings.supported_languages || [
        'html', 'php', 'vue', 'javascriptreact', 'blade', 
        'edge', 'hbs', 'handlebars', 'ejs', 'twig', 'nunjucks'
    ];
    
    connection.console.log(`Configuration updated: ${cssFolders.length} folders, ${cssFiles.length} files`);
    
    // Reinitialize CSS classes
    await initializeCssFiles();
});

// Handle completion requests
connection.onCompletion(async (textDocumentPosition) => {
    const document = documents.get(textDocumentPosition.textDocument.uri);
    
    if (!document) {
        return [];
    }
    
    const position = textDocumentPosition.position;
    const text = document.getText();
    const lines = text.split('\n');
    const currentLine = lines[position.line];
    const linePrefix = currentLine.substring(0, position.character);
    
    // Check if we're inside a class attribute or className
    const classAttrPatterns = [
        /class=["']([^"']*)$/,      // HTML class
        /className=["']([^"']*)$/,   // JSX className
        /class:\s*["']([^"']*)$/     // Vue/other frameworks
    ];
    
    let match = null;
    for (const pattern of classAttrPatterns) {
        match = pattern.exec(linePrefix);
        if (match) break;
    }
    
    if (!match) {
        return [];
    }
    
    // Get existing classes and the current prefix
    const existingClasses = match[1].split(/\s+/);
    const prefix = existingClasses.pop() || '';
    
    // Filter and return matching classes
    const completionItems = [];
    
    for (const [className, fileNames] of Object.entries(cssClasses)) {
        if (className.startsWith(prefix)) {
            const item = CompletionItem.create(className);
            item.kind = CompletionItemKind.Class;
            
            // Format the detail information
            if (Array.isArray(fileNames)) {
                item.detail = `From ${fileNames.join(', ')}`;
            } else {
                item.detail = `From ${fileNames}`;
            }
            
            completionItems.push(item);
        }
    }
    
    return completionItems;
});

// Custom notification handlers for extension commands
connection.onNotification('cssIntellisense/addFolder', async (params) => {
    await addCssFolder(params.folderPath);
    connection.sendNotification('cssIntellisense/scanComplete', {
        type: 'folder',
        path: params.folderPath
    });
});

connection.onNotification('cssIntellisense/addFile', async (params) => {
    await addCssFile(params.filePath);
    connection.sendNotification('cssIntellisense/scanComplete', {
        type: 'file',
        path: params.filePath
    });
});

connection.onNotification('cssIntellisense/refreshCache', async () => {
    await refreshCache();
    connection.sendNotification('cssIntellisense/cacheRefreshed');
});

connection.onNotification('cssIntellisense/clearCache', () => {
    clearCache();
    connection.sendNotification('cssIntellisense/cacheCleared');
});

connection.onNotification('cssIntellisense/fileChanged', async (params) => {
    await extractClasses(params.filePath);
});

connection.onNotification('cssIntellisense/fileDeleted', (params) => {
    removeClassesFromFile(params.fileName);
});

// Helper functions
async function addCssFolder(folderPath) {
    try {
        // Normalize path
        folderPath = normalizeUri(folderPath) || folderPath;
        
        // Check if folder exists
        if (!fsSync.existsSync(folderPath)) {
            connection.console.warn(`Folder not found: ${folderPath}`);
            return;
        }
        
        if (!cssFolders.includes(folderPath)) {
            cssFolders.push(folderPath);
        }
        
        connection.console.log(`Scanning folder: ${folderPath}`);
        await scanFolder(folderPath);
        connection.console.log(`Completed scanning folder: ${folderPath}`);
    } catch (err) {
        connection.console.error(`Error adding folder ${folderPath}: ${err.message}`);
    }
}

async function scanFolder(folder) {
    try {
        // Skip common directories that shouldn't be scanned
        const folderName = path.basename(folder);
        const skipDirs = ['node_modules', '.git', '.svn', '.hg', 'vendor', 'dist', 'build', '.vscode', '.idea'];
        if (skipDirs.includes(folderName)) {
            return;
        }
        
        const files = await fs.readdir(folder, { withFileTypes: true });
        const scanPromises = [];
        
        for (const file of files) {
            const filePath = path.join(folder, file.name);
            
            if (file.isDirectory()) {
                scanPromises.push(scanFolder(filePath));
            } else if (file.name.endsWith('.css')) {
                scanPromises.push(extractClasses(filePath));
            }
        }
        
        await Promise.all(scanPromises);
    } catch (err) {
        connection.console.error(`Error reading folder ${folder}: ${err.message}`);
    }
}

async function addCssFile(filePath) {
    try {
        // Normalize path
        filePath = normalizeUri(filePath) || filePath;
        
        if (!cssFiles.includes(filePath)) {
            cssFiles.push(filePath);
        }
        
        connection.console.log(`Adding file: ${filePath}`);
        await extractClasses(filePath);
        connection.console.log(`Completed adding file: ${filePath}`);
    } catch (err) {
        connection.console.error(`Error adding file ${filePath}: ${err.message}`);
    }
}

async function extractClasses(filePath) {
    try {
        if (!fsSync.existsSync(filePath)) {
            connection.console.warn(`CSS file not found: ${filePath}`);
            return;
        }
        
        const data = await fs.readFile(filePath, 'utf-8');
        const fileName = path.basename(filePath);
        
        // Remove comments
        let cleanData = data.replace(/\/\*[\s\S]*?\*\//g, '');
        
        // Remove strings to avoid false positives
        cleanData = cleanData.replace(/(["'])(?:(?=(\\?))\2.)*?\1/g, '');
        
        // Enhanced regex to capture classes
        const classRegex = /\.([a-zA-Z0-9_-]+)(?=[\s\{:,\.\[\]>~+])/g;
        let match;
        const foundClasses = new Set();
        
        while ((match = classRegex.exec(cleanData)) !== null) {
            foundClasses.add(match[1]);
        }
        
        // Store classes with their sources
        foundClasses.forEach(className => {
            if (!cssClasses[className]) {
                cssClasses[className] = [fileName];
            } else if (Array.isArray(cssClasses[className])) {
                if (!cssClasses[className].includes(fileName)) {
                    cssClasses[className].push(fileName);
                }
            } else {
                cssClasses[className] = [cssClasses[className], fileName];
            }
        });
        
        connection.console.log(`Extracted ${foundClasses.size} classes from ${fileName}`);
    } catch (err) {
        connection.console.error(`Error reading ${filePath}: ${err.message}`);
    }
}

async function refreshCache() {
    cssClasses = {};
    
    connection.console.log('Refreshing cache...');
    
    const folderPromises = cssFolders.map(folder => addCssFolder(folder));
    const filePromises = cssFiles.map(file => addCssFile(file));
    
    await Promise.all([...folderPromises, ...filePromises]);
    
    connection.console.log('Cache refreshed!');
}

function clearCache() {
    cssClasses = {};
    cssFolders = [];
    cssFiles = [];
    
    connection.console.log('Cache cleared');
}

function removeClassesFromFile(fileName) {
    for (const [className, sources] of Object.entries(cssClasses)) {
        if (Array.isArray(sources)) {
            cssClasses[className] = sources.filter(s => s !== fileName);
            if (cssClasses[className].length === 0) {
                delete cssClasses[className];
            }
        } else if (sources === fileName) {
            delete cssClasses[className];
        }
    }
}

async function searchCssInWorkspace() {
    if (workspaceFolders && workspaceFolders.length > 0) {
        const promises = workspaceFolders.map(folder => {
            const folderPath = normalizeUri(folder.uri);
            if (folderPath) {
                connection.console.log(`Auto-searching workspace: ${folderPath}`);
                return addCssFolder(folderPath);
            }
            return Promise.resolve();
        });
        await Promise.all(promises);
    }
}

function resolveWorkspacePath(filePath) {
    // Normalize the input path first
    filePath = normalizeUri(filePath) || filePath;
    
    if (path.isAbsolute(filePath)) {
        return filePath;
    }
    
    if (workspaceFolders && workspaceFolders.length > 0) {
        const workspaceUri = normalizeUri(workspaceFolders[0].uri);
        if (workspaceUri) {
            return path.join(workspaceUri, filePath);
        }
    }
    
    return null;
}

async function initializeCssFiles() {
    connection.console.log('Initializing CSS files...');
    
    if (autoSearch) {
        await searchCssInWorkspace();
    }
    
    // Scan CSS files from settings
    const filePromises = cssFiles.map(file => {
        const filePath = resolveWorkspacePath(file);
        return filePath ? addCssFile(filePath) : Promise.resolve();
    });
    
    // Scan CSS folders from settings
    const folderPromises = cssFolders.map(folder => {
        const folderPath = resolveWorkspacePath(folder);
        return folderPath ? addCssFolder(folderPath) : Promise.resolve();
    });
    
    await Promise.all([...filePromises, ...folderPromises]);
    
    connection.console.log(`Initialization complete. ${Object.keys(cssClasses).length} classes loaded.`);
}

// Make the text document manager listen on the connection
documents.listen(connection);

// Listen on the connection
connection.listen();

module.exports = { connection };
