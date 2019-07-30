/*-----------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat, Inc. All rights reserved.
 *  Licensed under the MIT License. See LICENSE file in the pipeline root for license information.
 *-----------------------------------------------------------------------------------------------*/

import * as tkn from '../src/tkn';
import { CliExitData, Cli } from '../src/cli';
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as chai from 'chai';
import * as sinonChai from 'sinon-chai';
import { ToolsConfig } from '../src/tools';
import { WindowUtil } from '../src/util/windowUtils';
import { window, Terminal } from 'vscode';
import jsYaml = require('js-yaml');
import { TestItem } from './tekton/testTektonitem';
import { ExecException } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream';

const expect = chai.expect;
chai.use(sinonChai);

// This needs to be edited to actually make sense wrt Tasks/TaskRuns in particular and nesting of resources
suite("tkn", () => {
    const tknCli: tkn.Tkn = tkn.TknImpl.Instance;
    let sandbox: sinon.SinonSandbox;
    const errorMessage = 'Error';

    setup(() => {
        sandbox = sinon.createSandbox();
        sandbox.stub(ToolsConfig, 'getVersion').resolves('0.0.15');
        tknCli.clearCache();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('command execution', () => {
        let execStub: sinon.SinonStub, toolsStub: sinon.SinonStub;
        const command = 'tkn do whatever you do';

        setup(() => {
            execStub = sandbox.stub(Cli.prototype, 'execute');
            toolsStub = sandbox.stub(ToolsConfig, 'detectOrDownload').resolves();
        });

        test('execute calls the given command in shell', async () => {
            const data = { stdout: 'done', stderr: '', error: null };
            execStub.resolves(data);
            const result = await tknCli.execute(command);

            expect(execStub).calledOnceWith(command);
            expect(result).deep.equals(data);
        });

        test('execute calls command with its detected location', async () => {
            const toolPath = 'path/to/tool/tool';
            execStub.resolves({ stdout: 'done', stderr: '', error: null });
            toolsStub.resolves(toolPath);
            await tknCli.execute(command);

            expect(execStub).calledOnceWith(command.replace('tkn', `"${toolPath}"`));
        });

        test('execute allows to set its working directory', async () => {
            execStub.resolves({ stdout: 'done', stderr: '', error: null });
            const cwd = 'path/to/some/dir';
            await tknCli.execute(command, cwd);

            expect(execStub).calledOnceWith(command, { cwd: cwd });
        });

        test('execute rejects if an error occurs in the shell command', async () => {
            const err: ExecException = { message: 'ERROR', name: 'err' };
            execStub.resolves({ error: err, stdout: '', stderr: '' });
            try {
                await tknCli.execute(command);
                expect.fail();
            } catch (error) {
                expect(error).equals(err);
            }
        });

        test('execute can be set to pass errors through exit data', async () => {
            const err: ExecException = { message: 'ERROR', name: 'err' };
            execStub.resolves({ error: err, stdout: '', stderr: '' });
            const result = await tknCli.execute(command, null, false);

            expect(result).deep.equals({ error: err, stdout: '', stderr: '' });
        });

        test('executeInTerminal send command to terminal and shows it', async () => {
            const termFake: Terminal = {
                name:  "name",
                processId: Promise.resolve(1),
                sendText: sinon.stub(),
                show: sinon.stub(),
                hide: sinon.stub(),
                dispose: sinon.stub()
            };
            toolsStub.restore();
            toolsStub = sandbox.stub(ToolsConfig, 'detectOrDownload').resolves(path.join('segment1', 'segment2'));
            const ctStub = sandbox.stub(WindowUtil, 'createTerminal').returns(termFake);
            await tknCli.executeInTerminal('tkn');
            // tslint:disable-next-line: no-unused-expression
            expect(termFake.show).calledOnce;
            expect(ctStub).calledWith('Tekton', process.cwd(), 'segment1');
        });
    });

    suite('item listings', () => {
        let execStub: sinon.SinonStub, yamlStub: sinon.SinonStub;
        const pipelineNodeItem = new TestItem(undefined, 'pipelinenode', tkn.ContextType.PIPELINENODE);
        const pipelineItem1 = new TestItem(pipelineNodeItem, 'pipeline1', tkn.ContextType.PIPELINE);
        const pipelineItem2 = new TestItem(pipelineNodeItem, 'pipeline2', tkn.ContextType.PIPELINE);
        const pipelineItem3 = new TestItem(pipelineNodeItem, 'pipeline3', tkn.ContextType.PIPELINE);
        const pipelinerun = new TestItem(pipelineItem1, 'pipelinerun', tkn.ContextType.PIPELINERUN, undefined, "2019-07-25T12:03:00Z", "True");
        const taskItem = new TestItem(null, 'task', tkn.ContextType.TASK);

        setup(() => {
            execStub = sandbox.stub(tknCli, 'execute');
            yamlStub = sandbox.stub(jsYaml, 'safeLoad');
            sandbox.stub(fs, 'readFileSync');
        });

        test('getPipelines returns items created from tkn get pipeline', async () => {
            const tknPipelines = ['pipeline1', 'pipeline2', 'pipeline3'];
            execStub.resolves({ stdout: tknPipelines.join('\n'), stderr: '', error: null });
            const result = await tknCli.getPipelines(pipelineNodeItem);

            expect(execStub).calledWith(tkn.Command.listPipelines());
            expect(result.length).equals(3);
            for (let i = 1; i < result.length; i++) {
                expect(result[i].getName()).equals(tknPipelines[i]);
            }
        });

        test('getPipelines returns empty list if tkn produces no output', async () => {
            execStub.resolves({ stdout: '', stderr: '', error: null });
            const result = await tknCli.getPipelines(pipelineNodeItem);

            expect(result).empty;
        });

        test('getPipelines returns empty list if an error occurs', async () => {
            const errorStub = sandbox.stub(window, 'showErrorMessage');
            sandbox.stub(tknCli, 'getPipelines').resolves([]);
            execStub.rejects(errorMessage);
            const result = await tknCli.getPipelines(pipelineNodeItem);

            expect(result).empty;
            expect(errorStub).calledOnceWith(`Cannot retrieve pipelines for current cluster. Error: ${errorMessage}`);
        });

        test('getPipelineRuns returns pipelineruns for a pipeline', async () => {
            const activeApps = [{ name: 'pipelinerun1', pipeline: 'pipeline1' }, { name: 'pipelinerun2', pipeline: 'pipeline1'}];
            yamlStub.returns({ ActivePipelineRuns: activeApps });
            execStub.returns({
                error: undefined,
                stdout: JSON.stringify({
                        items: [
                            {
                                metadata: {
                                    name: 'pipelinerun1',
                                    namespace: 'pipeline'
                                }
                            }
                        ]
                    }
                ),
                stderr: ''
            });
            const result = await tknCli.getPipelineRuns(pipelineNodeItem);

            expect(result.length).equals(1);
            expect(result[0].getName()).equals('pipelinerun1');
        });

        test('getPipelineRuns returns empty list if no tkn pipelineruns are present', async () => {
            const activeApps = [{ name: 'pipelinerun1', pipeline: 'pipeline1' }, { name: 'pipelinerun2', pipeline: 'pipeline1'}];
            yamlStub.returns({ ActivePipelineRuns: activeApps });
            execStub.returns({
                error: undefined,
                stdout: JSON.stringify({
                        items: []
                    }
                ),
                stderr: ''
            });
            const result = await tknCli.getPipelineRuns(pipelineNodeItem);

            expect(result).empty;
        });

        test('getTaskRun returns taskrun list for a pipelinerun', async () => {
            const activeApps = [{ name: 'taskrun1', pipeline: 'pipeline1' }, { name: 'taskrun2', pipeline: 'pipeline1'}];
            yamlStub.returns({ ActivePipelineRuns: activeApps });
            execStub.returns({
                error: undefined,
                stdout: JSON.stringify({
                        items: [
                            {
                                metadata: {
                                    name: 'taskrun1'
                                }
                            }
                        ]
                    }
                ),
                stderr: ''
            });
            const result = await tknCli.getPipelineRuns(pipelinerun);

            expect(result.length).equals(1);
            expect(result[0].getName()).equals('taskrun1');
        });

        test('getTaskruns returns taskruns for a pipelinerun', async () => {
            const taskruns = ['taskrun1', 'taskrun2', 'taskrun3'];
            execStub.resolves({ error: null, stderr: '', stdout: taskruns.join('\n') });
            const result = await tknCli.getTaskRuns(pipelinerun);

            expect(execStub).calledWith(tkn.Command.listTaskRuns(taskruns[0]));
            expect(result.length).equals(3);
            for (let i = 0; i < result.length; i++) {
                expect(result[i].getName()).equals(taskruns[i]);
            }
        });

        test('getTaskruns returns an empty list if an error occurs', async () => {
            execStub.onFirstCall().resolves({error: undefined, stdout: '', stderr: ''});
            execStub.onSecondCall().rejects(errorMessage);
            const result = await tknCli.getTaskRuns(pipelinerun);

            expect(result).empty;
        });

        test('getPipelineRunChildren returns taskruns for an pipelinerun', async () => {
            execStub.onFirstCall().resolves({error: undefined, stdout: JSON.stringify({
                items: [
                    {
                        metadata: {
                            name: 'taskrun1',
                        },

                    }
                ]
            }), stderr: ''});
            execStub.onSecondCall().resolves({error: undefined, stdout: 'serv', stderr: ''});
            //TODO: Probably need a get children here
            const result = await tknCli.getPipelineRuns(pipelinerun);

            expect(result[0].getName()).deep.equals('taskrun1');
        });
    });
});