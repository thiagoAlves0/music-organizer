class Logger {
  constructor(emit) {
    this.emit = emit || (() => {});
  }
  info(msg) {
    this.emit(`ℹ ${msg}`);
  }
  success(msg) {
    this.emit(`✔ ${msg}`);
  }
  error(msg) {
    this.emit(`❌ ${msg}`);
  }
}

module.exports = Logger;
