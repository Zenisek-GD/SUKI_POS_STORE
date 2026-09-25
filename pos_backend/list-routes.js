import routes from './routes/index.js';
// Inspect the router without starting the server or opening the store database.
const router = routes({}, { demo: false });
for (const layer of router.stack) {
  if (!layer.route) continue;
  for (const method of Object.keys(layer.route.methods))
    console.log(`${method.toUpperCase().padEnd(7)} /api${layer.route.path}`);
}
console.log('GET     /xianfire');
console.log('GET     /* (built React application)');
