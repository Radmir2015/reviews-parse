const link = 'http://otzovik.com/scripts/captcha/index.php?rand=8568215';

const sharp = require('sharp')
const Jimp = require('jimp')
const path = require('path')

const run = async () => {
    const image = await Jimp.read(link)
    const buffer = await image.getBufferAsync(Jimp.MIME_JPEG)
    const sharpImage = sharp(buffer)
    
    const savePath = path.join(__dirname, 'captcha', 'captcha.jpg')
    
    await fs.mkdir(path.join(__dirname, 'captcha'), { recursive: true })
    
    await sharpImage
        .toFormat('jpg')
        .toFile(savePath)
}

run().catch(console.error)