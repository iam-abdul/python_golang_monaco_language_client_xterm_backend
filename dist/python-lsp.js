import directoryTree from "directory-tree";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { WebSocketMessageReader, WebSocketMessageWriter, } from "vscode-ws-jsonrpc";
import { createConnection, createServerProcess, forward, } from "vscode-ws-jsonrpc/server";
import { Message, InitializeRequest, } from "vscode-languageserver";
import fs from "fs";
import path from "path";
import chokidar from "chokidar";
import pty from "node-pty";
const app = express();
app.use(cors());
app.use(express.json());
function logToFile(message) {
    const logFilePath = "server_log.txt"; // Specify the path to your log file
    // fs.appendFile(logFilePath, `${message}\n`, (err) => {
    //   if (err) {
    //     console.error("Error appending to log file:", err);
    //   }
    // });
}
const allServerConfig = [
    {
        serverName: "GOPLS",
        pathName: "/gopls",
        serverPort: 80,
        runCommand: "gopls",
        runCommandArgs: ["serve"],
        // wsServerOptions: {
        //   noServer: true,
        //   perMessageDeflate: false,
        //   clientTracking: true,
        // },
    },
    {
        serverName: "PYRIGHT",
        pathName: "/pyright",
        serverPort: 80,
        runCommand: "node",
        runCommandArgs: [
            "./node_modules/pyright/dist/pyright-langserver.js",
            "--stdio",
        ],
    },
];
const websocketConfig = {
    noServer: true,
    perMessageDeflate: false,
    clientTracking: true,
};
const launchLanguageServer = (runconfig, socket) => {
    const { serverName, runCommand, runCommandArgs } = runconfig;
    // start the language server as an external process
    const reader = new WebSocketMessageReader(socket);
    const writer = new WebSocketMessageWriter(socket);
    const socketConnection = createConnection(reader, writer, () => socket.dispose());
    const serverConnection = createServerProcess(serverName, runCommand, runCommandArgs);
    if (serverConnection) {
        forward(socketConnection, serverConnection, (message) => {
            if (Message.isRequest(message)) {
                // console.log(`${serverName} Server received:`);
                logToFile("<==============server received=============>");
                logToFile(JSON.stringify(message));
                // console.log(message);
                if (message.method === InitializeRequest.type.method) {
                    const initializeParams = message.params;
                    initializeParams.processId = process.pid;
                }
            }
            if (Message.isResponse(message)) {
                // console.log(`${serverName} Server sent:`);
                // console.log(message);
                logToFile("<----------server sent------------>");
                logToFile(JSON.stringify(message));
            }
            return message;
        });
    }
};
/*
 * This part is for getting and putting files
 */
const getAllFiles = function (dirPath) {
    // console.log("all files ", directoryTree(dirPath));
    return [directoryTree(dirPath)];
};
const shell = "bash";
const watchDir = "/home/minimumGuy";
app.get("*", (req, res) => {
    // Construct the full path to the file
    try {
        console.log("req path", req.path);
        const decodedPath = decodeURIComponent(req.path);
        const filePath = path.join(watchDir, decodedPath);
        // Send the file
        res.sendFile(filePath, (err) => {
            if (err) {
                console.error("Error sending file:", err);
                res.status(500).send("Error reading file from disk.");
            }
            else {
                console.log("File sent successfully:", filePath);
            }
        });
    }
    catch (err) {
        console.log("err sending files");
        return res.status(500).json({
            message: err,
        });
    }
});
app.put("/*", (req, res) => {
    // @ts-expect-error noice
    const filePath = req.params[0];
    console.log(filePath);
    console.log("body", req.body.content);
    fs.writeFileSync(path.join(watchDir, filePath), req.body.content);
    res.status(200).json({ message: "File created" });
});
app.post("/create-directory", (req, res) => {
    try {
        const { path } = req.body;
        fs.mkdirSync(path);
        res.status(200).json({ message: "Directory created" });
    }
    catch (err) {
        console.log("error creating directory", err);
        res.status(500).json({ message: "Error creating directory" });
    }
});
app.post("/create-file", (req, res) => {
    try {
        const { path } = req.body;
        fs.writeFileSync(path, "");
        res.status(200).json({ message: "File created" });
    }
    catch (err) {
        console.log("error creating file", err);
        res.status(500).json({ message: "Error creating file" });
    }
});
const httpServer = app.listen(80);
const wss = new WebSocketServer(websocketConfig);
const attachTerminal = (socket) => {
    // first time send the directory list
    const message = {
        isTerminal: false,
        isExplorer: true,
        data: getAllFiles(watchDir),
    };
    socket.send(JSON.stringify(message));
    // attach a node-pty to the terminal
    const ptyProcess = pty.spawn(shell, [], {
        name: "xterm-color",
        env: process.env,
        cwd: watchDir,
    });
    socket.onMessage((data) => {
        ptyProcess.write(data);
    });
    // Output: Sent to the frontend
    ptyProcess.onData(function (rawOutput) {
        const processedOutput = rawOutput;
        const message = {
            isTerminal: true, // Event name
            data: processedOutput, // Actual data
        };
        // ws.send(processedOutput);
        socket.send(JSON.stringify(message));
    });
    // this part is for chokidar watcher
    const watcher = chokidar.watch(watchDir, {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        ignoreInitial: true,
    });
    watcher.on("add", (path) => {
        try {
            console.log(`File ${path} has been added`);
            // getAllFiles(watchDir);
            const message = {
                isTerminal: false,
                isExplorer: true,
                data: getAllFiles(watchDir),
            };
            socket.send(JSON.stringify(message));
        }
        catch (err) {
            console.log("error adding file", err);
        }
    });
    watcher.on("addDir", (path) => {
        try {
            console.log(`Directory ${path} has been added`);
            const message = {
                isTerminal: false,
                isExplorer: true,
                data: getAllFiles(watchDir),
            };
            socket.send(JSON.stringify(message));
        }
        catch (err) {
            console.log("error adding directory", err);
        }
    });
    watcher.on("unlink", (path) => {
        try {
            console.log(`File ${path} has been removed`);
            const message = {
                isTerminal: false,
                isExplorer: true,
                data: getAllFiles(watchDir),
            };
            socket.send(JSON.stringify(message));
        }
        catch (err) {
            console.log("error removing file", err);
        }
    });
    watcher.on("unlinkDir", (path) => {
        try {
            console.log(`Directory ${path} has been removed`);
            const message = {
                isTerminal: false,
                isExplorer: true,
                data: getAllFiles(watchDir),
            };
            // @ts-ignore
            if (socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify(message));
            }
            else {
                console.log("WebSocket is not open");
            }
        }
        catch (err) {
            console.log("error removing directory", err);
        }
    });
};
httpServer.on("upgrade", (request, socket, head) => {
    const baseURL = `http://${request.headers.host}`;
    const pathName = request.url
        ? new URL(request.url, baseURL).pathname
        : undefined;
    console.log("the upgrade websocket request is: ", request.url);
    for (let x = 0; x < allServerConfig.length; x++) {
        const serverConfig = allServerConfig[x];
        if (pathName === serverConfig.pathName) {
            wss.handleUpgrade(request, socket, head, (webSocket) => {
                const socket = {
                    send: (content) => webSocket.send(content, (error) => {
                        if (error) {
                            throw error;
                        }
                    }),
                    onMessage: (cb) => webSocket.on("message", (data) => {
                        console.log(data.toString());
                        cb(data);
                    }),
                    onError: (cb) => webSocket.on("error", cb),
                    onClose: (cb) => webSocket.on("close", cb),
                    dispose: () => webSocket.close(),
                };
                // launch the server when the web socket is opened
                if (webSocket.readyState === webSocket.OPEN) {
                    const { serverName, runCommand, runCommandArgs } = serverConfig;
                    launchLanguageServer(serverConfig, socket);
                    console.log("launching language server");
                }
                else {
                    console.log("web socket is not open");
                    webSocket.on("open", () => {
                        launchLanguageServer(serverConfig, socket);
                    });
                }
            });
        }
        else if (x === allServerConfig.length - 1 && pathName === "/terminal") {
            console.log("terminal path");
            wss.handleUpgrade(request, socket, head, (webSocket) => {
                const socket = {
                    send: (content) => webSocket.send(content, (error) => {
                        if (error) {
                            throw error;
                        }
                    }),
                    onMessage: (cb) => webSocket.on("message", (data) => {
                        console.log(data.toString());
                        cb(data);
                    }),
                    onError: (cb) => webSocket.on("error", cb),
                    onClose: (cb) => webSocket.on("close", cb),
                    dispose: () => webSocket.close(),
                };
                attachTerminal(socket);
                // Start the ping-pong mechanism
                let pingInterval;
                pingInterval = setInterval(() => {
                    webSocket.ping(() => { });
                }, 10000); // Send a ping every 10 seconds
                // Handle pong responses
                webSocket.on('pong', () => {
                    console.log('Received pong from client');
                });
                // Handle close event
                webSocket.on('close', () => {
                    clearInterval(pingInterval); // Stop sending pings when the connection is closed
                });
            });
        }
    }
    /*
     * this place is for node-pty, we attach it with xterm.js
     */
});
//# sourceMappingURL=python-lsp.js.map