/* vim: set tw=78 ts=4: */

var path = require('path');
var Tree = require('paths2tree')();
var archy = require('archy');

var mach = require('mach');

var through = require('through2').obj;

// this is the old way to serve a build app, we serve from memory fully (?)
// maybe can nicely integrate with gulp.dest and serve from fs
// app.use(mach.file, {root: path.join(__dirname, 'public'), index: ['index.html']})

// create new root node, if needed
function autofresh(state) {
  if(!state.fresh)
    return;

  state.fresh = false;
  state.tree = new Tree('.');

  // lazy computed
  state.index = null;
}

// render the tree to a JSON datastructure
function indexJSON(state, options) {
  var o = options || {all: true};
  var index = {}

  if (o.all || o.filecount)
    index.filecount = 0;

  if (o.all || o.files)
    index.files = [];

  if (o.all || o.filelist)
    index.filelist = [];

  if (o.all || o.filenames)
    index.filenames = {}

  state.index = state.index || state.tree.compact_root().reduce(
    function accumulateNode(index, node){

      var frep = {
        filename: node.label,
        filepath: node.leaf && node.leaf.path
      };

      if (o.all || o.filecount)
        index.filecount += 1;

      if (o.all || o.files)
        index.files.push(frep.filename);

      if (o.all || o.filelist)
        index.filelist.push(frep);

      if (o.all || o.filenames)
        index.filenames[frep.filename] = frep;

      return index;

    }, index);

  return state.index;

};

// create a 'tree' out of vinyl VFS objects
module.exports = function(options) {

	var state = {
    index: null,
    tree: null, // where we keep our file tree
    fresh: true // true if a new tree needs to be created
  };

  // the server
  var app = mach.stack();

  // user passed in a number, she or he means: port number
	if ('number' === typeof options)
		options = { port: options };

	// or passed full options object / didn't pass any
	options =  options || {};

  //app.use(mach.gzip);
  app.use(mach.params);
  app.use(mach.contentType, 'text/html');

  if (! options.quiet)
    app.use(mach.logger);

  if (options.bower)
    app.use(mach.file, {root: path.join(__dirname, 'bower_components')});

  // we serve the tree as an index.json file
  app.get('/index.json', function serveIndex(conn) {
    conn.json(200, indexJSON(state));
  });

  // handle regular file gets, by looking them up in the tree
  app.get(/.*/, function serveTreenode(conn){

    // remove trailing slash
    var stripped = conn.path.replace(/^\//, '');

    var node = state.tree.find_child(stripped)

    if(!node)
      return 404;

    return node.leaf.contents;
  });

  // start the server
  mach.serve(app, options.port || 3000);

  return function createPipe(){
    return through(
      function collect(vfs, encoding, done){

        // check if we need to create a fresh state
        autofresh(state);

        var vpath = vfs.relative;

        // when gulp.src(['test','test/a']) these files will have
        // relative paths 'test' and 'a', so in that case the
        // wrong tree is constructed => use the cwdRelative option.
        //
        // downside is that you might have to strip of some dirs
        if(options.cwdRelative)
        {
          // only the cwd is stable in a set of files
          // (and maybe not even)
          vpath = path.relative(vfs.cwd, vfs.path);
        }

        // update the tree
        state.tree.push_path(vpath, vfs);

        // done handling the 'data' event, just pass file unchanged
        this.push(vfs);
        done();
      },
      function(done){
        // collapse singleton root node
        //var compact = state.tree.compact_root();

        if(! options.quiet)
          console.log(archy(state.tree));

        // if root has only one node, make that the root
        // overriding our predefined root '.'
        if(options.foldRoot)
          state.tree = state.tree.compact_root();

        // mark end of path stream
        state.fresh = true;

        // done handling the 'end' event
        done();
      }
    );
  }
}
