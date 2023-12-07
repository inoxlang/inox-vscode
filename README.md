**👉 Once the extension is installed make sure to read [Requirements](#requirements) and [Usage](#usage).**


# Inox extension

https://marketplace.visualstudio.com/items?itemName=graphr00t.inox

This extension provides support for the Inox programming language.\
[Features](#features)

<details>

**<summary>👉 Click Here if you use VSCodium</summary>**

Click on the marketplace link above and then on `Download Extension` to download the VSIX file for the extension:\
![image](https://user-images.githubusercontent.com/113632189/235324122-3f75a2bd-1238-4c53-9192-bcc530ab68c1.png)

You can install the extension in VSCodium by going on the **Extensions**
tab and clicking here:\
![image](https://user-images.githubusercontent.com/113632189/235324154-631e215c-1130-4da1-ae2a-a19806cd28c8.png)

</details>

## Requirements

By default this extension requires a project server to be listening on `wss://localhost:8305`.
You can install the [inoxd daemon](https://github.com/inoxlang/inox/blob/master/docs/inox-daemon.md) to 
start a project server automatically.

If the project server runs on a **remote server** (e.g. a VPS) you have to update the [Websocket Endpoint](command:workbench.action.openSettings?%22%40ext%3Agraphr00t.inox%22) setting to the following value:
```
wss://<server-ip>:8305
```


## Usage

**Creating a project**

- Create a folder (example: `inox-web-app`)
- Open it with VSCode
- Execute the VSCode command `Inox: Initialize new Project in Current Folder`

**Opening a project**

- The first time open the `xxx.code-workspace` file and click on the floating button '**Open Workspace**'
- Subsequent times you can directly go in **File** > **Open Recent**:

  ![recent workspace](./assets/docs/recent-workspace.png)


## Features

- [Tutorials](#tutorials)
- Syntax highlighting
- Convenient snippets
- LSP support
  - Error diagnostics
  - Hover information
  - Completions
  - Formatting
- Debugging

### Tutorials

![tutorial demo](assets/docs/tutorial-demo.gif)

### Debugging

![img](assets/docs/debug-demo.png)