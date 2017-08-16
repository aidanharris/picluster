/* eslint-env phantomjs,browser */
/* eslint-disable func-names */
/* global casper */
casper.options.waitTimeout = 20000;

casper.test.begin('nodes.html', 2, test => {
  const URL = casper.cli.get('url');
  const username = casper.cli.get('username');
  const password = casper.cli.get('password');
  const flLinux = casper.cli.get('font-linux');
  casper.start(URL);

  casper.viewport(1920, 1080).then(function Viewport() {
    const lib = require('../lib/index.js')(this);
    lib.doLogin(username, password);

    this.evaluate(() => {
      document.querySelectorAll('nav>ul>li')[1].querySelectorAll('li>a')[1].click();
    });

    const iframe = this.evaluate(() => {
      const iframes = document.getElementsByTagName('iframe');

      return iframes[0].src;
    });

    this.page.switchToChildFrame(0);

    test.assertEquals(iframe, URL + '/nodes.html', 'The iframes source should equal ' + URL + '/nodes.html');

    if (lib.getCasperEngine() === 'slimerjs') {
      this.waitForSelector('#modal-body2>p>span', function () {
        const fontLinux = this.evaluate(() => {
          return document.querySelector('#modal-body2>p>span').className;
        });

        test.assertEquals(fontLinux, flLinux, 'The distro icon should be \'' + flLinux + '\'');

        casper.test.done();
      });
    } else {
      test.skip(1, 'Skipping distro icon test as this does not run under ' + lib.getCasperEngine());
      casper.test.done();
    }
  });

  casper.run();
});
