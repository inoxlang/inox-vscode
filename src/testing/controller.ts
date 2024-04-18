import * as vscode from 'vscode';



export function createTestController(){
    const controller = vscode.tests.createTestController('inoxTestController', 'Inox');
}
