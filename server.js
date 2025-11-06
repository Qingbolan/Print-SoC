const express = require('express');
const multer = require('multer');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');
const { PDFDocument } = require('pdf-lib');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    // Only accept PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || (() => {
    console.warn('WARNING: Using default session secret. Set SESSION_SECRET environment variable for production!');
    return require('crypto').randomBytes(32).toString('hex');
  })(),
  resave: false,
  saveUninitialized: false,
  cookie: { 
    maxAge: 3600000, // 1 hour
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
    httpOnly: true, // Prevent XSS attacks
    sameSite: 'strict' // Prevent CSRF attacks
  }
}));
app.use(express.static('public'));

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// A4 page dimensions in points (72 points = 1 inch)
const A4_LANDSCAPE_WIDTH = 841.89;  // 297mm in points
const A4_LANDSCAPE_HEIGHT = 595.28; // 210mm in points

// Booklet layout generator
function generateBookletLayout(totalPages) {
  // Calculate pages needed (must be multiple of 4 for booklet)
  const sheetsNeeded = Math.ceil(totalPages / 4);
  const totalPagesNeeded = sheetsNeeded * 4;
  const blankPages = totalPagesNeeded - totalPages;
  
  const layout = [];
  
  // Generate the page order for booklet printing
  // Each sheet has 4 pages: front-left, front-right, back-left, back-right
  for (let i = 0; i < sheetsNeeded; i++) {
    const sheetNum = i + 1;
    const frontRight = i * 2 + 1;
    const frontLeft = totalPagesNeeded - (i * 2);
    const backLeft = i * 2 + 2;
    const backRight = totalPagesNeeded - (i * 2) - 1;
    
    layout.push({
      sheet: sheetNum,
      front: [frontLeft, frontRight],
      back: [backLeft, backRight]
    });
  }
  
  return {
    layout,
    totalPages,
    totalPagesNeeded,
    blankPages,
    sheetsNeeded
  };
}

// Process PDF for booklet printing
async function processPDFForBooklet(inputPath, outputPath) {
  try {
    // Validate paths are in the uploads directory
    const uploadsDir = path.resolve('uploads');
    const resolvedInput = path.resolve(inputPath);
    const resolvedOutput = path.resolve(outputPath);
    
    if (!resolvedInput.startsWith(uploadsDir) || !resolvedOutput.startsWith(uploadsDir)) {
      throw new Error('Invalid file path');
    }
    
    const existingPdfBytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const totalPages = pdfDoc.getPageCount();
    
    const bookletInfo = generateBookletLayout(totalPages);
    const newPdfDoc = await PDFDocument.create();
    
    // Create booklet pages
    for (const sheet of bookletInfo.layout) {
      // Front page (2 pages side by side)
      const frontPage = newPdfDoc.addPage([A4_LANDSCAPE_WIDTH, A4_LANDSCAPE_HEIGHT]);
      
      // Add front-left page
      if (sheet.front[0] <= totalPages) {
        const [leftPage] = await newPdfDoc.copyPages(pdfDoc, [sheet.front[0] - 1]);
        const { width, height } = leftPage.getSize();
        frontPage.drawPage(leftPage, {
          x: 0,
          y: (A4_LANDSCAPE_HEIGHT - height) / 2,
          width: width / 2,
          height: height / 2
        });
      }
      
      // Add front-right page
      if (sheet.front[1] <= totalPages) {
        const [rightPage] = await newPdfDoc.copyPages(pdfDoc, [sheet.front[1] - 1]);
        const { width, height } = rightPage.getSize();
        frontPage.drawPage(rightPage, {
          x: A4_LANDSCAPE_WIDTH / 2,
          y: (A4_LANDSCAPE_HEIGHT - height) / 2,
          width: width / 2,
          height: height / 2
        });
      }
      
      // Back page (2 pages side by side)
      const backPage = newPdfDoc.addPage([A4_LANDSCAPE_WIDTH, A4_LANDSCAPE_HEIGHT]);
      
      // Add back-left page
      if (sheet.back[0] <= totalPages) {
        const [leftPage] = await newPdfDoc.copyPages(pdfDoc, [sheet.back[0] - 1]);
        const { width, height } = leftPage.getSize();
        backPage.drawPage(leftPage, {
          x: 0,
          y: (A4_LANDSCAPE_HEIGHT - height) / 2,
          width: width / 2,
          height: height / 2
        });
      }
      
      // Add back-right page
      if (sheet.back[1] <= totalPages) {
        const [rightPage] = await newPdfDoc.copyPages(pdfDoc, [sheet.back[1] - 1]);
        const { width, height } = rightPage.getSize();
        backPage.drawPage(rightPage, {
          x: A4_LANDSCAPE_WIDTH / 2,
          y: (A4_LANDSCAPE_HEIGHT - height) / 2,
          width: width / 2,
          height: height / 2
        });
      }
    }
    
    const pdfBytes = await newPdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);
    
    return bookletInfo;
  } catch (error) {
    throw new Error(`Error processing PDF: ${error.message}`);
  }
}

// SSH connection and file transfer
function submitPrintJob(host, username, password, filePath, printerOptions) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    
    conn.on('ready', () => {
      // Generate a safe remote filename with timestamp
      const timestamp = Date.now();
      const safeFileName = `print_job_${timestamp}.pdf`;
      const remotePath = `/tmp/${safeFileName}`;
      
      conn.sftp((err, sftp) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        
        // Upload file
        sftp.fastPut(filePath, remotePath, (err) => {
          if (err) {
            conn.end();
            return reject(err);
          }
          
          // Execute print command with properly escaped arguments
          // Using array form to avoid shell injection
          const printArgs = [];
          if (printerOptions.duplex) {
            printArgs.push('-o', 'sides=two-sided-long-edge');
          }
          if (printerOptions.copies > 1) {
            printArgs.push(`-#${printerOptions.copies}`);
          }
          printArgs.push(remotePath);
          
          const printCmd = `lpr ${printArgs.join(' ')} && rm "${remotePath}"`;
          
          conn.exec(printCmd, (err, stream) => {
            if (err) {
              conn.end();
              return reject(err);
            }
            
            let output = '';
            let errorOutput = '';
            
            stream.on('close', (code, signal) => {
              conn.end();
              if (code === 0) {
                resolve({ success: true, output });
              } else {
                reject(new Error(`Print command failed: ${errorOutput}`));
              }
            }).on('data', (data) => {
              output += data.toString();
            }).stderr.on('data', (data) => {
              errorOutput += data.toString();
            });
          });
        });
      });
    });
    
    conn.on('error', (err) => {
      reject(err);
    });
    
    conn.connect({
      host,
      port: 22,
      username,
      password
    });
  });
}

// Routes
// NOTE: For production deployment, add rate limiting middleware (e.g., express-rate-limit)
// to prevent abuse of file uploads and API endpoints

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get booklet layout preview
app.post('/api/booklet-layout', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Validate file path is in uploads directory
    const uploadsDir = path.resolve('uploads');
    const resolvedFilePath = path.resolve(req.file.path);
    if (!resolvedFilePath.startsWith(uploadsDir)) {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    const pdfBytes = fs.readFileSync(req.file.path);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();
    
    const bookletInfo = generateBookletLayout(totalPages);
    
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    
    res.json(bookletInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit print job
app.post('/api/submit-job', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Validate file path is in uploads directory
    const uploadsDir = path.resolve('uploads');
    const resolvedFilePath = path.resolve(req.file.path);
    if (!resolvedFilePath.startsWith(uploadsDir)) {
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    const { server, username, password, enableBooklet, duplex, copies } = req.body;
    
    // Validate inputs
    if (!server || !username || !password) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Validate username format (alphanumeric and underscore, 3-20 chars)
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Invalid username format. Use alphanumeric characters only (3-20 characters)' });
    }
    
    // Validate password length (minimum 6 characters)
    if (password.length < 6 || password.length > 100) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Password must be between 6 and 100 characters' });
    }
    
    // Validate server selection
    if (server !== 'stu' && server !== 'stf') {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Invalid server selection' });
    }
    
    // Determine server host
    const serverHost = server === 'stu' ? 'stu.comp.nus.edu.sg' : 'stf.comp.nus.edu.sg';
    
    let filePath = req.file.path;
    
    // Process for booklet if enabled
    if (enableBooklet === 'true') {
      const bookletPath = `${req.file.path}_booklet.pdf`;
      await processPDFForBooklet(filePath, bookletPath);
      fs.unlinkSync(filePath); // Remove original
      filePath = bookletPath;
    }
    
    const printerOptions = {
      duplex: duplex === 'true',
      copies: parseInt(copies) || 1
    };
    
    // Submit print job via SSH
    await submitPrintJob(serverHost, username, password, filePath, printerOptions);
    
    // Clean up
    fs.unlinkSync(filePath);
    
    res.json({ success: true, message: 'Print job submitted successfully' });
  } catch (error) {
    // Clean up file if exists
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`🦙 NUS Llama Printer running on http://localhost:${PORT}`);
});
