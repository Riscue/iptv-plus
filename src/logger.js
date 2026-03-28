function getTimestamp() {
    return new Date().toLocaleString('tr-TR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

module.exports = {
    error: function (tag) {
        var args = Array.prototype.slice.call(arguments).slice(1);
        var prefix = '[' + getTimestamp() + '] [ERROR] [' + tag + ']';
        console.error.apply(console, [prefix].concat(args));
    }, log: function (tag) {
        var args = Array.prototype.slice.call(arguments).slice(1);
        var prefix = '[' + getTimestamp() + '] [INFO] [' + tag + ']';
        console.log.apply(console, [prefix].concat(args));
    }
};
