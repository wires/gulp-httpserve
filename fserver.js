/* vim: set tw=78 ts=4: */

var path = require('path');
var Tree = require('paths2tree')();
var archy = require('archy');

var mach = require('mach');

var through = require('through2').obj;

// this is the old way to serve a build app, we serve from memory fully (?)
// maybe can nicely integrate with gulp.dest and serve from fs
// app.use(mach.file, {root: path.join(__dirname, 'public'), index: ['index.html']})

// render the tree to a JSON datastructure
function indexJSON(state, options) {
	function rec(node){
		// skip directories
		if(!node.leaf)
			return {
				label: node.label + '/',
				nodes: node.nodes.map(rec)
			};

		return {
			label: node.label,
			nodes: node.nodes.map(rec),
			path: node.path('/'),
			meta: node.leaf.frontMatter || {}
		};
	};

	state.index = rec(state.tree);

  return state.index;
};


// create new root node, if needed
function autofresh(state) {
  if(!state.fresh)
    return;

  state.fresh = false;
  state.tree = new Tree('.');

  // lazy computed
  state.index = null;
}

// create a 'tree' out of vinyl VFS objects
module.exports = function(options) {

	var state = {
    index: null,
    tree: null, // where we keep our file tree
    fresh: true // true if a new tree needs to be created
  };

  autofresh(state);

  // the server
  var app = mach.stack();

  // user passed in a number, she or he means: port number
	if ('number' === typeof options)
		options = { port: options };

	// or passed full options object / didn't pass any
	options =  options || {compactRoot: true};

    options.index = options.index || 'index.html';

  //app.use(mach.gzip);
//  app.use(mach.mapper);
  app.use(mach.rewrite, '/', '/' + options.index);
  app.use(mach.params);
  app.use(mach.contentType, 'text/html');

  if (! options.quiet)
    app.use(mach.logger);

  // serve static dirs
  (options.static || []).forEach(function(dir){
    console.log('serving static files from: ' + dir);
    app.use(mach.file, {root: dir});
  });

  // we serve the tree as an index.json file
  app.get('/index.json', function serveIndex(conn) {
    conn.json(200, indexJSON(state));
  });

  // handle regular file gets, by looking them up in the tree
  app.get(/.*/, function serveTreenode(conn){

    // remove initial slash
    var stripped = conn.path.replace(/^\//, '');

    // TODO URL sanitization
    var node = state.tree.find_path(stripped, '/');

    if(!node)
      return 404;

    // regular files
    if(node.leaf && node.leaf.contents)
      return node.leaf.contents;

    // directory listing
    return '<ul>' + node.nodes.map(function(n){
		return '<li><a href="/' + n.path('/') + '">' + n.label + '</a></li>';
	}) + '</ul>';
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

        // update the tree (but skip the index)
        state.tree.push_path(vpath, vfs);

        // done handling the 'data' event, just pass file unchanged
        this.push(vfs);
        done();
      },
      function(done){
        // collapse singleton root node
        //var compact = state.tree.compact_root();

        console.log(state.tree && state.tree.size())

        if(! options.quiet)
          console.log(archy(state.tree));

        // if root has only one node, make that the root
        // overriding our predefined root '.'
        if(options.compactRoot)
          state.tree = state.tree.compact_root();

        // mark end of path stream
        state.fresh = true;

        // done handling the 'end' event
        done();
      }
    );
  }
}
