const jimp = require('jimp');
console.log('Type of jimp:', typeof jimp);
console.log('Keys of jimp:', Object.keys(jimp));
try {
    console.log('Jimp.read type:', typeof jimp.read);
} catch(e) {}
try {
    console.log('jimp.Jimp.read type:', typeof jimp.Jimp.read);
} catch(e) {}
