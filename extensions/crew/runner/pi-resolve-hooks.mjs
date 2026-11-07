// Module-resolution hooks that make the crew host use the same Pi packages as the user's Pi. The extension
// declares Pi's packages as peers (the host Pi provides them); a separate process has no such provider, so
// bare imports of them from outside Pi's own tree are resolved from Pi's install instead. Inside Pi's tree
// resolution is untouched.
let parent;
let tree;
const PI_PACKAGE = /^(@earendil-works\/|typebox(\/|$))/;

export function initialize(data) {
  parent = data.parent;
  tree = data.tree;
}

export function resolve(specifier, context, next) {
  if (parent && PI_PACKAGE.test(specifier) && !context.parentURL?.startsWith(tree))
    return next(specifier, { ...context, parentURL: parent });
  return next(specifier, context);
}
