/*-----------------------------------------------------------------------------------------------
 *  Copyright (c) Red Hat, Inc. All rights reserved.
 *  Licensed under the MIT License. See LICENSE file in the project root for license information.
 *-----------------------------------------------------------------------------------------------*/

import * as chai from 'chai';
import * as sinonChai from 'sinon-chai';
import { PipelineExplorer } from '../src/pipeline/pipelineExplorer';
import { TknImpl, ContextType } from '../src/tkn';
import { TestItem } from './tekton/testTektonitem';
import sinon = require('sinon');
import { doesNotReject } from 'assert';

const expect = chai.expect;
chai.use(sinonChai);

suite('Tekton Application Explorer', () => {
    const pipelineItem = new TestItem(null, 'pipeline', ContextType.PIPELINE);
    const pipelinerunItem = new TestItem(pipelineItem, 'pipelinerun', ContextType.PIPELINERUN);
    const taskrunItem = new TestItem(pipelinerunItem, 'taskrun', ContextType.TASKRUN);
    const taskItem = new TestItem(taskrunItem, 'task', ContextType.TASK);
    const sandbox = sinon.createSandbox();

    let tektonInstance: PipelineExplorer;

    setup(() => {
        sandbox.stub(TknImpl.prototype, 'getPipelines').resolves([pipelineItem]);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('delegate calls to TektonObject instance', async () => {
        tektonInstance = PipelineExplorer.getInstance();
        pipelineItem.getChildren().push(pipelinerunItem);
        pipelinerunItem.getChildren().push(taskrunItem);
        taskrunItem.getChildren().push(taskItem);
        const pipelines = await tektonInstance.getChildren();
        expect(pipelines[0]).equals(pipelineItem);
        const taskruns = await tektonInstance.getChildren(pipelinerunItem);
        expect(taskruns[0]).equals(taskrunItem);
        expect(tektonInstance.getParent(pipelinerunItem)).equals(pipelineItem);
        expect(tektonInstance.getTreeItem(taskrunItem)).equals(taskrunItem);
    });

});