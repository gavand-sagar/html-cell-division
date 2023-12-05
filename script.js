const storageNames = {
    colorsArray: 'colorsArray',
    myColor: 'myColor'
}
const colors = ["red", 'blue', 'green', 'orange', 'pink', 'yellow', 'cyan']
var interval = null;
const canvas = getCanvas();
const ctx = getCanvasContext()


function updateCanvasHeight() {
    canvas.style.height = window.innerHeight;
    canvas.style.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.width = window.innerWidth;
}

window.addEventListener('resize', () => {
    updateCanvasHeight()
})

window.addEventListener('load', () => {
    init();
    interval = setInterval(() => {
        drawMyShape()
    }, 100)
})
window.addEventListener('beforeunload', () => {
    let myColor = getSessionStorageItem(storageNames.myColor)
    if (myColor) {
        pushLocalStorageArray(storageNames.colorsArray, myColor)
    }
    localStorage.removeItem(myColor)
    clearInterval(interval)
})

function init() {
    updateCanvasHeight()
    let oldColors = getLocalStorageItem(storageNames.colorsArray);
    if (!(oldColors && oldColors.length > 0)) {
        setLocalStorageItem(storageNames.colorsArray, colors)
    };

    let myColor = popLocalStorageArray(storageNames.colorsArray)
    setSessionStorageItem(storageNames.myColor, myColor);
}

/**
 * 
 * @returns {CanvasRenderingContext2D}
 */
function getCanvasContext() {
    const myCanvas = getCanvas();
    const ctx = myCanvas.getContext("2d");
    return ctx;
}

/**
 * 
 * @returns {HTMLElement}
 */
function getCanvas() {
    return document.getElementById("canvas");
}

function drawMyShape() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    let myColor = getSessionStorageItem(storageNames.myColor)
    let myObj = {
        screenX: self.screenX,
        screenY: self.screenY,
        centerX: (canvas.width / 2),
        centerY: (canvas.height / 2),
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        color: myColor
    };
    setLocalStorageItem(myColor, myObj)

    ctx.beginPath();
    ctx.strokeStyle = myColor
    ctx.arc(myObj.centerX, myObj.centerY, 150, 0, 2 * Math.PI);
    ctx.stroke();

    let others = colors.filter(x => x != myColor)
    for (const otherColorName of others) {
        let otherObj = getLocalStorageItem(otherColorName)
        if (otherObj) {
            ctx.beginPath();
            ctx.strokeStyle = myColor
            ctx.moveTo(myObj.centerX, myObj.centerY);
            ctx.lineTo(...getOtherCenter(myObj, otherObj));
            ctx.stroke()
        }

    }


}


/**
 * 
 * @param {{    screenX:number,    screenY:number,    centerX:number,    centerY:number,    canvasWidth:number,    canvasHeight :number,    color: string}} myObj 
 * @param {{    screenX:number,    screenY:number,    centerX:number,    centerY:number,    canvasWidth:number,    canvasHeight :number,    color: string}} other 
 */
function getOtherCenter(myObj, other) {    
    return [
        other.screenX - myObj.screenX + other.centerX, 
        other.screenY - myObj.screenY + other.centerY]
}

function pushLocalStorageArray(name, value) {
    let arry = getLocalStorageItem(name) ?? [];
    arry.push(value);
    setLocalStorageItem(name, arry)
}

function popLocalStorageArray(name) {
    let arry = getLocalStorageItem(name) ?? [];
    let item = arry.pop();
    setLocalStorageItem(name, arry)
    return item;
}

function getLocalStorageItem(name) {
    if (!localStorage.getItem(name)) {
        return null
    }
    return JSON.parse(localStorage.getItem(name))
}
function setLocalStorageItem(name, value) {
    localStorage.setItem(name, JSON.stringify(value))
}

function getSessionStorageItem(name) {
    if (!sessionStorage.getItem(name)) {
        return null
    }
    return JSON.parse(sessionStorage.getItem(name))
}
function setSessionStorageItem(name, value) {
    sessionStorage.setItem(name, JSON.stringify(value))
}