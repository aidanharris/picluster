import router from '../router';

const LOGIN_URL = '/';

export default {
  get token() {
    return localStorage.getItem('token');
  },

  get authenticated() {
    return typeof this.token === 'string' && this.token.length > 0;
  },

  login(context, creds, redirect) {
    context.$http.post(LOGIN_URL, creds, data => {
      localStorage.setItem('token', data.token);

      if (redirect) {
        router.go(redirect);
      }
    }).error(err => {
      context.error = err;
    });
  },

  logout() {
    localStorage.removeItem('token');
  }
};
