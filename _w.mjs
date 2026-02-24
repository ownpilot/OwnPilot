import{writeFileSync as w}from"fs";const Q=String.fromCharCode(39);function q(s){return Q+s+Q}let L=[];process.stdin.on("data",d=>L.push(d.toString()));process.stdin.on("end",()=>{const c=L.join("").split("
").map(l=>l.replace(/«/g,Q)).join("
");w(process.argv[2],c);console.log("Written",c.length,"chars")});