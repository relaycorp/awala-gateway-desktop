const exec = require('child_process').exec;
const fs = require('fs');

async function runReport(args) {
  return new Promise(function(resolve, reject) {
    exec('npx license-report --output=json ' + args, function (error, stdout, stderr) {
      if (error) {
        console.log('exec error: ' + error);
        reject(stderr);
      } else {
        resolve(JSON.parse(stdout));
      }
    });
  });
}

async function getData() {
  const uiLibs  = await runReport("--exclude=daemon");
  const daemonLibs = await runReport("--package=node_modules/daemon/package.json");

  console.log("UI", uiLibs.length, "dependencies");
  console.log("Daemon", daemonLibs.length, "dependencies");

  const filtered = daemonLibs.filter(function(lib) {
    const matched = uiLibs.find(function(element) {
      return ( element.name === lib.name &&
        element.installedVersion === lib.installedVersion &&
        element.author === lib.author )
    });

    if (matched) {
      console.log('Matched', lib.name);
    }

    return matched === undefined;
  });

  return [...uiLibs, ...filtered].sort((lib1, lib2) => {
    if (lib1.name < lib2.name) {
       return -1;
    }

    if (lib1.name > lib2.name) {
      return 1;
    }

    return 0;
  });
}

getData().then(function(result) {
  console.log("Merged", result.length, "dependencies");
  fs.writeFileSync('src/licenses.json', JSON.stringify(result));
});
