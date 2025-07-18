import { NextResponse } from 'next/server';
import { uploadToPinataServer } from '@/lib/pinata-server';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    
    // Validate file type
    if (!file.type.match('image.*')) {
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });
    }
    
    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size exceeds 2MB limit' }, { status: 400 });
    }
    
    // Upload to Pinata
    const ipfsHash = await uploadToPinataServer(file);
    const ipfsUrl = `https://gateway.pinata.cloud/ipfs/${ipfsHash}`;
    
    return NextResponse.json({
      success: true,
      ipfsHash,
      ipfsUrl
    });
  } catch (error) {
    console.error('Error uploading to Pinata:', error);
    return NextResponse.json(
      { error: 'Failed to upload image to IPFS' },
      { status: 500 }
    );
  }
} 