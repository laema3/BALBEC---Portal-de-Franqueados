import app from "../server";

export default function handler(req: any, res: any) {
  try {
    // Determine the true requested API path from Vercel headers or req.url
    const originalUrl = req.headers['x-matched-path'] || req.url || '';
    
    if (originalUrl && originalUrl.startsWith('/api')) {
      req.url = originalUrl;
    } else if (req.url && !req.url.startsWith('/api')) {
      req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
    }

    return app(req, res);
  } catch (error: any) {
    console.error("[Vercel Serverless Fatal]", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal Server Error in Serverless Handler",
        message: error?.message || String(error)
      });
    }
  }
}
