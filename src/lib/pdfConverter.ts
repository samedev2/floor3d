import * as pdfjsLib from 'pdfjs-dist';

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export async function convertPDFToImages(file: File): Promise<string[]> {
  const images: string[] = [];
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    const numPages = pdf.numPages;
    
    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      
      // Set scale for better quality
      const scale = 2.0;
      const viewport = page.getViewport({ scale });
      
      // Create canvas
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      // Render page to canvas (using older API)
      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };
      
      await page.render(renderContext as any).promise;
      
      // Convert to data URL
      const dataUrl = canvas.toDataURL('image/png', 1.0);
      images.push(dataUrl);
    }
    
    return images;
  } catch (error) {
    console.error('PDF conversion error:', error);
    throw new Error('Falha ao converter PDF: ' + (error instanceof Error ? error.message : 'Desconhecido'));
  }
}

export async function convertFileToImage(file: File): Promise<string> {
  const type = file.type;
  
  // Image files - direct conversion
  if (type.startsWith('image/')) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Falha ao ler imagem'));
      reader.readAsDataURL(file);
    });
  }
  
  // PDF files - use pdf.js
  if (type === 'application/pdf') {
    const images = await convertPDFToImages(file);
    if (images.length > 0) {
      return images[0]; // Return first page
    }
    throw new Error('PDF não tem páginas');
  }
  
  throw new Error('Formato não suportado: ' + type);
}
