export async function uploadToPinataServer(file: File): Promise<string> {
  try {
    const formData = new FormData();
    formData.append('file', file);
    
    const pinataApiKey = process.env.PINATA_API_KEY;
    const pinataSecretApiKey = process.env.PINATA_SECRET_API_KEY;
    
    if (!pinataApiKey || !pinataSecretApiKey) {
      throw new Error('Pinata API keys not configured');
    }
    
    const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        'pinata_api_key': pinataApiKey,
        'pinata_secret_api_key': pinataSecretApiKey,
      },
      body: formData,
    });
    
    if (!response.ok) {
      throw new Error(`Pinata upload failed: ${response.statusText}`);
    }
    
    const result = await response.json();
    return result.IpfsHash;
  } catch (error) {
    console.error('Error uploading to Pinata:', error);
    throw new Error('Failed to upload to IPFS');
  }
} 