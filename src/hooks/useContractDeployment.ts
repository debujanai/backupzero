import { useState } from 'react';
import { ethers } from 'ethers';
import { ContractDetails, DeploymentResult } from '@/types';
import { optimizeGas } from '@/utils/blockchain';

export function useContractDeployment() {
  const [contractDetails, setContractDetails] = useState<ContractDetails>({
    name: '',
    symbol: '',
    decimals: '18',
    totalSupply: '',
    features: ['burnable'], // Default to burnable since Ownable is always present
    optimizationLevel: 'standard',
    logoUrl: '',
    description: '',
    buyTax: 0,
    sellTax: 0,
  });

  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentResult, setDeploymentResult] = useState<DeploymentResult | null>(null);
  const [deploymentError, setDeploymentError] = useState<string>('');
  const [deploymentProgress, setDeploymentProgress] = useState(0);
  const [deploymentStatus, setDeploymentStatus] = useState<string>('');

  const handleAutoGenerate = async () => {
    const randomNames = [
      'CryptoGem', 'MoonToken', 'DiamondCoin', 'StarToken', 'GalaxyGem',
      'QuantumCoin', 'NebulaCoin', 'InfinityToken', 'CosmicGem', 'VortexCoin'
    ];
    
    const randomSymbols = [
      'CGM', 'MOON', 'DIAM', 'STAR', 'GLXY',
      'QNTM', 'NEBL', 'INFTY', 'COSM', 'VRTX'
    ];
    
    const randomIndex = Math.floor(Math.random() * randomNames.length);
    const randomSupply = Math.floor(Math.random() * 900000000) + 100000000; // 100M to 1B
    
    // Select realistic default features from the new OpenZeppelin features
    const defaultFeatures = ['burnable']; // Basic features
    const optionalFeatures = ['pausable', 'access control', 'permit'];
    const selectedOptional = optionalFeatures.filter(() => Math.random() > 0.5);
    
    setContractDetails(prev => ({
      ...prev,
      name: randomNames[randomIndex],
      symbol: randomSymbols[randomIndex],
      totalSupply: randomSupply.toString(),
      features: [...defaultFeatures, ...selectedOptional],
      buyTax: Math.floor(Math.random() * 3), // 0-2%
      sellTax: Math.floor(Math.random() * 5) // 0-4%
    }));
  };

  const handleDeploy = async (
    signer: ethers.JsonRpcSigner,
    provider: ethers.BrowserProvider,
    chainId: number
  ) => {
    if (!contractDetails.name || !contractDetails.symbol || !contractDetails.totalSupply) {
      alert('Please fill in all required fields');
      return;
    }

    setIsDeploying(true);
    setDeploymentError('');
    setDeploymentProgress(0);
    setDeploymentStatus('Preparing deployment...');

    try {
      // Step 1: Generate contract code
      setDeploymentProgress(10);
      setDeploymentStatus('Generating contract code...');
      
      const deploymentData = {
        name: contractDetails.name,
        symbol: contractDetails.symbol,
        decimals: parseInt(contractDetails.decimals),
        totalSupply: contractDetails.totalSupply,
        features: contractDetails.features,
        optimizationLevel: contractDetails.optimizationLevel,
        logoUrl: contractDetails.logoUrl,
        description: contractDetails.description,
        buyTax: contractDetails.buyTax,
        sellTax: contractDetails.sellTax,
        chainId: chainId
      };

      console.log('Sending contract details to API:', deploymentData);

      const response = await fetch('/api/deploy-contract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contractDetails: deploymentData
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      setDeploymentProgress(30);
      setDeploymentStatus('Contract code generated successfully');

      // Step 2: Compile and deploy
      setDeploymentProgress(50);
      setDeploymentStatus('Compiling contract...');

      const factory = new ethers.ContractFactory(
        result.abi,
        result.bytecode,
        signer
      );

      setDeploymentProgress(70);
      setDeploymentStatus('Deploying contract...');

      // Estimate gas
      const signerAddress = await signer.getAddress();
      const estimatedGas = await factory.getDeployTransaction(signerAddress).then(tx => 
        provider.estimateGas(tx)
      );

      const gasOptimization = await optimizeGas(provider, estimatedGas);

      // Deploy contract
      const contract = await factory.deploy(
        await signer.getAddress(), // Pass the signer address as initialOwner
        {
          gasLimit: estimatedGas + BigInt(50000), // Add buffer
          ...gasOptimization
        }
      );

      setDeploymentProgress(90);
      setDeploymentStatus('Waiting for confirmation...');

      const receipt = await contract.deploymentTransaction()?.wait();
      
      if (!receipt) {
        throw new Error('Deployment transaction failed');
      }

      setDeploymentProgress(100);
      setDeploymentStatus('Contract deployed successfully!');

      const deploymentResult: DeploymentResult = {
        address: await contract.getAddress(),
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        verificationStatus: 'pending'
      };

      setDeploymentResult(deploymentResult);

      // Step 3: Auto-verification (if supported)
      if (chainId === 1 || chainId === 137 || chainId === 56) {
        const delayForVerification = async (ms: number) => {
          return new Promise(resolve => setTimeout(resolve, ms));
        };

        try {
          await delayForVerification(10000); // Wait 10 seconds
          setDeploymentStatus('Attempting auto-verification...');
          
          const verificationResponse = await fetch('/api/deploy-contract/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              address: deploymentResult.address,
              sourceCode: result.contractCode,
              contractName: contractDetails.name,
              compilerVersion: '0.8.19',
              optimizationUsed: contractDetails.optimizationLevel !== 'none',
              runs: contractDetails.optimizationLevel === 'high' ? 1000 : 200,
              chainId: chainId
            }),
          });

          if (verificationResponse.ok) {
            setDeploymentResult(prev => prev ? {
              ...prev,
              verificationStatus: 'success'
            } : null);
            setDeploymentStatus('Contract verified successfully!');
          } else {
            setDeploymentResult(prev => prev ? {
              ...prev,
              verificationStatus: 'failed'
            } : null);
            setDeploymentStatus('Contract deployed but verification failed');
          }
        } catch (verificationError) {
          console.error('Verification error:', verificationError);
          setDeploymentResult(prev => prev ? {
            ...prev,
            verificationStatus: 'failed'
          } : null);
          setDeploymentStatus('Contract deployed but verification failed');
        }
      }

    } catch (error: any) {
      console.error('Deployment error:', error);
      setDeploymentError(error.message || 'Deployment failed');
      setDeploymentStatus('Deployment failed');
    } finally {
      setIsDeploying(false);
    }
  };

  const handleFeatureToggle = (featureId: string) => {
    setContractDetails(prev => ({
      ...prev,
      features: prev.features.includes(featureId)
        ? prev.features.filter(f => f !== featureId)
        : [...prev.features, featureId]
    }));
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('File size must be less than 5MB');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload-to-pinata', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const result = await response.json();
      setContractDetails(prev => ({
        ...prev,
        logoUrl: result.ipfsUrl
      }));
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload logo');
    }
  };

  return {
    contractDetails,
    setContractDetails,
    isDeploying,
    deploymentResult,
    deploymentError,
    deploymentProgress,
    deploymentStatus,
    handleAutoGenerate,
    handleDeploy,
    handleFeatureToggle,
    handleLogoUpload
  };
} 