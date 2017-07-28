casper.test.begin('nodes.html', 2, function(test) {
  const URL = casper.cli.get('url');
  const username = casper.cli.get('username');
  const password = casper.cli.get('password');
  const flLinux = casper.cli.get('font-linux');

  casper.start(URL);

  casper.viewport(1920, 1080).then(function() {
      const lib = require('../lib/index.js')(this);

      lib.doLogin(username, password);

      this.evaluate(function() {
        document.querySelectorAll('nav>ul>li')[1].querySelectorAll('li>a')[1].click();
      });

      var iframe = this.evaluate(function() {
        var iframes = document.getElementsByTagName('iframe');

        return iframes[0].src;
      });

      this.page.switchToChildFrame(0);

      casper.waitForSelector('#modal-body2>p>span', function() {

        var fontLinux = this.evaluate(function() {
          return document.querySelector('#modal-body2>p>span').className;
        });

        test.assertEquals(iframe, URL + '/nodes.html', "The iframes source should equal " + URL + "/nodes.html");

        test.assertEquals(fontLinux, flLinux, "The distro icon should be '" + flLinux + "'");

        casper.test.done();

      });
  });

  casper.run();

});
