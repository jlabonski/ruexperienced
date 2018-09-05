#!/usr/bin/env node --use_strict --trace-deprecation --trace-warnings

const figlet = require('figlet');
const chalk = require('chalk');
const log4js = require('log4js');
const sywac = require('sywac');
const util = require('util');
const controller = require('./controller');

require('clarify');
require('trace');
// Clamps the depth of the trace. See the `trace` docs.
Error.stackTraceLimit = 100;

const logger = log4js.getLogger();
logger.level = 'warn';

const bugs = 'off'; // eslint-disable-line no-unused-vars

// Get console.dir() information more verbose.
util.inspect.defaultOptions.showHidden = false;
util.inspect.defaultOptions.depth = 3;
util.inspect.defaultOptions.colors = true;

// Vomit uncontrollably if we do something wrong.
process.on('unhandledRejection', (up) => {
    logger.error('Unhandled promise rejection, process abort');
    throw up;
});


(async () => {

    const title = '\n\n' + chalk.blue(figlet.textSync('ruexperienced', { font: 'ANSI Shadow' }));

    const args = await sywac
        .positional('<username> <companyID> <password>', {
            params: [
                { type: 'string' },
                { type: 'number' },
                { type: 'string' },
            ],
            paramsDesc: [
                'Your username',
                'Company ID',
                'Password'
            ]
        })
        .boolean('-v, --verbose', { desc: 'Verbose logging' })
        .boolean('--trace', { desc: 'Trace logging, implies verbose' })
        .style({
            usagePositionals: str => chalk.green(str),
            desc: str => chalk.cyan(str),
        })
        .help('-h, --help')
        .version('--version')
        .showHelpByDefault()
        .preface(title, 'Completes the sexual harassment course for you')
        .outputSettings({ maxWidth: 75 })
        .example('$0 fullname 12345 p@ssw0rd!', { desc: 'Take the test for "Ms. Full Name" at company 12345'})
        .parseAndExit();

    if (args.verbose) {
        logger.level = 'debug';
    }

    if (args.trace) {
        logger.level = 'trace';
    }

    console.log(title);
    await controller.start(args.username, args.companyID, args.password);

})();
