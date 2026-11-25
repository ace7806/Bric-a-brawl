/// <reference types="vite/client" />
import './style.css';
import { assert } from '@sim/assert';
import { ErrorCode } from '@sim/enums';
import { BricABrawlApp } from './app';

const canvas = document.getElementById('stage');
const uiRoot = document.getElementById('ui-root');
assert(canvas instanceof HTMLCanvasElement, ErrorCode.MissingRequiredEntry, 'Missing #stage canvas');
assert(uiRoot instanceof HTMLElement, ErrorCode.MissingRequiredEntry, 'Missing #ui-root element');

const app = new BricABrawlApp(canvas, uiRoot);
void app.start();
